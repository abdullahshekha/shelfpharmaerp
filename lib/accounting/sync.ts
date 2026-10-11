// Idempotent sync engine: (sourceType, sourceId) -> the auto journal entries that record's current state implies.
// syncSource deletes all auto entries for the source and recreates them, inside one transaction guarded by a
// per-source advisory lock. Business routes call syncSafe AFTER their own transaction commits.
import { prisma } from '@/lib/prisma'
import { assertNotLocked, getSettings, postEntry } from './core'
import { ensureChart } from './accounts'
import {
  buildCustomerPayment,
  buildDeliveryCogs,
  buildInvoice,
  buildPurchaseInvoice,
  buildSalesReturn,
  buildSupplierPayment,
  buildSupplierReturn,
  type BuiltEntry,
} from './builders'

export type SourceType =
  | 'INVOICE'
  | 'DELIVERY_COGS'
  | 'PAYMENT'
  | 'SALES_RETURN'
  | 'PURCHASE_INVOICE'
  | 'SUPPLIER_PAYMENT'
  | 'SUPPLIER_RETURN'

export const SOURCE_TYPES: SourceType[] = [
  'INVOICE',
  'DELIVERY_COGS',
  'PAYMENT',
  'SALES_RETURN',
  'PURCHASE_INVOICE',
  'SUPPLIER_PAYMENT',
  'SUPPLIER_RETURN',
]

export type SyncResult = { status: 'posted' | 'removed' | 'skipped' | 'unchanged'; reason?: string }

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
type Loaded = { date: Date; entries: BuiltEntry[] } | null

const n = (v: unknown) => Number(v ?? 0)

/** Loads the record and maps it to builder output. Returns null when the record no longer exists. */
async function load(tx: Tx, type: SourceType, id: string): Promise<Loaded> {
  switch (type) {
    case 'INVOICE': {
      const r = await tx.invoice.findUnique({ where: { id } })
      if (!r) return null
      if (r.status === 'DRAFT') return { date: r.invoiceDate, entries: [] } // void invoice: no ledger entries
      return {
        date: r.invoiceDate,
        entries: buildInvoice({
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate,
          retailerId: r.retailerId,
          subtotal: n(r.subtotal),
          discountAmount: n(r.discountAmount),
          taxAmount: n(r.taxAmount),
          totalAmount: n(r.totalAmount),
        }),
      }
    }
    case 'DELIVERY_COGS': {
      const r = await tx.order.findUnique({ where: { id }, include: { items: true, delivery: true } })
      if (!r) return null
      const date = r.delivery?.deliveredAt ?? r.updatedAt
      if (r.status !== 'DELIVERED') return { date, entries: [] }
      return {
        date,
        entries: buildDeliveryCogs({
          orderNumber: r.orderNumber,
          date,
          items: r.items.map((i) => ({ quantity: i.quantity, unitCost: i.unitCost == null ? null : n(i.unitCost) })),
        }),
      }
    }
    case 'PAYMENT': {
      const r = await tx.payment.findUnique({ where: { id }, include: { invoice: { select: { invoiceNumber: true } } } })
      if (!r) return null
      return {
        date: r.paymentDate,
        entries: buildCustomerPayment({
          paymentDate: r.paymentDate,
          amount: n(r.amount),
          method: r.method,
          retailerId: r.retailerId,
          reference: r.reference,
          invoiceNumber: r.invoice?.invoiceNumber ?? null,
        }),
      }
    }
    case 'SALES_RETURN': {
      const r = await tx.salesReturn.findUnique({ where: { id }, include: { items: { include: { batch: { select: { purchasePrice: true } } } } } })
      if (!r) return null
      return {
        date: r.returnDate,
        entries: buildSalesReturn({
          returnNumber: r.returnNumber,
          returnDate: r.returnDate,
          retailerId: r.retailerId,
          totalAmount: n(r.totalAmount),
          items: r.items.map((i) => ({
            quantity: i.quantity,
            restocked: i.restocked,
            batchPurchasePrice: i.batch ? n(i.batch.purchasePrice) : null,
          })),
        }),
      }
    }
    case 'PURCHASE_INVOICE': {
      const r = await tx.purchaseInvoice.findUnique({ where: { id }, include: { items: true } })
      if (!r) return null
      return {
        date: r.invoiceDate,
        entries: buildPurchaseInvoice({
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate,
          supplierId: r.supplierId,
          totalAmount: n(r.totalAmount),
          items: r.items.map((i) => ({
            lineTotal: n(i.lineTotal),
            salesTaxAmount: n(i.salesTaxAmount),
            aitCollectibleAmount: n(i.aitCollectibleAmount),
            aitPayableAmount: n(i.aitPayableAmount),
          })),
        }),
      }
    }
    case 'SUPPLIER_PAYMENT': {
      const r = await tx.supplierPayment.findUnique({ where: { id }, include: { purchaseInvoice: { select: { invoiceNumber: true } } } })
      if (!r) return null
      return {
        date: r.paymentDate,
        entries: buildSupplierPayment({
          paymentDate: r.paymentDate,
          amount: n(r.amount),
          method: r.method,
          supplierId: r.supplierId,
          invoiceNumber: r.purchaseInvoice?.invoiceNumber ?? null,
        }),
      }
    }
    case 'SUPPLIER_RETURN': {
      const r = await tx.supplierReturn.findUnique({ where: { id } })
      if (!r) return null
      return {
        date: r.returnDate,
        entries: buildSupplierReturn({
          returnNumber: r.returnNumber,
          returnDate: r.returnDate,
          supplierId: r.supplierId,
          totalAmount: n(r.totalAmount),
        }),
      }
    }
  }
}

type SettingsRow = Awaited<ReturnType<typeof getSettings>>

const paisa = (v: unknown) => Math.round(Number(v ?? 0) * 100)

/** Stable signature of an entry set: date, memo and sorted lines (account id, paisa debit/credit, parties). */
function entrySig(entries: { date: Date; memo: string | null; lines: { accountId: string; debit: unknown; credit: unknown; retailerId?: string | null; supplierId?: string | null; employeeId?: string | null }[] }[]): string {
  return JSON.stringify(
    entries
      .map((e) => ({
        d: e.date.getTime(),
        m: e.memo ?? '',
        l: e.lines
          .map((l) => `${l.accountId}|${paisa(l.debit)}|${paisa(l.credit)}|${l.retailerId ?? ''}|${l.supplierId ?? ''}|${l.employeeId ?? ''}`)
          .sort(),
      }))
      .sort((a, b) => a.m.localeCompare(b.m) || a.d - b.d),
  )
}

/** Throws on builder/data errors (callers classify). */
async function syncInner(type: SourceType, id: string): Promise<SyncResult> {
  // Cheap pre-check outside any transaction: until a go-live date exists the hooks are inert.
  const pre = await getSettings(prisma)
  if (!pre.goLiveDate) return { status: 'skipped', reason: 'no go-live date set' }

  return prisma.$transaction(
    async (tx): Promise<SyncResult> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${type + ':' + id}))`
      const settings: SettingsRow = await getSettings(tx)
      if (!settings.goLiveDate) return { status: 'skipped', reason: 'no go-live date set' }

      const existing = await tx.journalEntry.findMany({
        where: { sourceType: type, sourceId: id, isManual: false },
        include: { lines: true },
      })

      const loaded = await load(tx, type, id)
      let entries: BuiltEntry[] = []
      let reason: string | undefined
      if (loaded) {
        if (loaded.date.getTime() < settings.goLiveDate.getTime()) reason = 'dated before go-live'
        else entries = loaded.entries
      }

      // Unchanged? Compare the fresh build with what is already posted and leave the entries alone.
      if (entries.length && existing.length === entries.length) {
        const chart = await ensureChart(tx)
        let bankId: string | null = null
        if (entries.some((e) => e.lines.some((l) => l.accountKey === 'BANK'))) {
          if (settings.defaultBankAccountId) {
            const ok = await tx.account.findUnique({ where: { id: settings.defaultBankAccountId }, select: { id: true, isActive: true } })
            if (ok && ok.isActive) bankId = ok.id
          }
        }
        const fresh = entries.map((e) => ({
          date: e.date,
          memo: e.memo,
          lines: e.lines.map((l) => ({
            accountId: l.accountId ?? (l.accountKey === 'BANK' && bankId ? bankId : chart[l.accountKey!]),
            debit: l.debit ?? 0,
            credit: l.credit ?? 0,
            retailerId: l.retailerId,
            supplierId: l.supplierId,
            employeeId: l.employeeId,
          })),
        }))
        if (entrySig(fresh) === entrySig(existing)) return { status: 'unchanged' }
      }
      if (!entries.length && !existing.length) return reason ? { status: 'skipped', reason } : { status: 'unchanged' }

      for (const e of existing) {
        try {
          assertNotLocked(settings, e.date)
        } catch {
          return { status: 'skipped', reason: 'existing entries are in a locked period' }
        }
      }
      for (const e of entries) {
        try {
          assertNotLocked(settings, e.date)
        } catch {
          return { status: 'skipped', reason: 'dated in a locked period' }
        }
      }

      if (existing.length) await tx.journalEntry.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } })
      for (const e of entries) {
        await postEntry(tx, { date: e.date, memo: e.memo, sourceType: type, sourceId: id, isManual: false, lines: e.lines })
      }
      if (entries.length) return { status: 'posted' }
      return reason ? { status: 'removed', reason } : { status: 'removed' }
    },
    { maxWait: 10000, timeout: 15000 },
  )
}

export async function syncSource(type: SourceType, id: string): Promise<SyncResult> {
  try {
    return await syncInner(type, id)
  } catch (err) {
    return { status: 'skipped', reason: `error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Never throws. Await it after the business transaction has committed. */
export async function syncSafe(type: SourceType, id: string | null | undefined): Promise<void> {
  if (!id) return
  try {
    const r = await syncSource(type, id)
    if (r.reason?.startsWith('error:')) console.error(`[accounting] sync ${type} ${id} failed: ${r.reason}`)
  } catch (err) {
    console.error(`[accounting] sync ${type} ${id} failed`, err)
  }
}

/** Sync several (type, id) pairs sequentially; never throws. */
export async function syncAllSafe(pairs: [SourceType, string | null | undefined][]): Promise<void> {
  for (const [t, id] of pairs) await syncSafe(t, id)
}

// ---------------- Rebuild (chunkable) ----------------

export type RebuildStep = SourceType | 'ORPHANS'
const STEPS: RebuildStep[] = [...SOURCE_TYPES, 'ORPHANS']

export interface RebuildReport {
  goLiveDate: string | null
  done: boolean
  next: { type: RebuildStep; after: string | null } | null
  total: number
  posted: number
  removed: number
  unchanged: number
  skipped: { type: SourceType; id: string; reason: string }[]
  errors: { type: SourceType; id: string; error: string }[]
  byType: Record<string, { posted: number; removed: number; unchanged: number; skipped: number; errors: number }>
  orphansRemoved: number
}

function emptyReport(goLive: Date | null): RebuildReport {
  const byType: RebuildReport['byType'] = {}
  for (const t of SOURCE_TYPES) byType[t] = { posted: 0, removed: 0, unchanged: 0, skipped: 0, errors: 0 }
  return { goLiveDate: goLive ? goLive.toISOString() : null, done: true, next: null, total: 0, posted: 0, removed: 0, unchanged: 0, skipped: [], errors: [], byType, orphansRemoved: 0 }
}

/** Where-clause selecting the records of a type that qualify for the ledger (dated on/after go-live). */
function qualifying(type: SourceType, from: Date): any {
  switch (type) {
    case 'INVOICE':
      return { invoiceDate: { gte: from } }
    case 'DELIVERY_COGS':
      return {
        status: 'DELIVERED',
        OR: [
          { delivery: { is: { deliveredAt: { gte: from } } } },
          { AND: [{ OR: [{ delivery: { is: null } }, { delivery: { is: { deliveredAt: null } } }] }, { updatedAt: { gte: from } }] },
        ],
      }
    case 'PAYMENT':
      return { paymentDate: { gte: from } }
    case 'SALES_RETURN':
      return { returnDate: { gte: from } }
    case 'PURCHASE_INVOICE':
      return { invoiceDate: { gte: from } }
    case 'SUPPLIER_PAYMENT':
      return { paymentDate: { gte: from } }
    case 'SUPPLIER_RETURN':
      return { returnDate: { gte: from } }
  }
}

async function findIds(type: SourceType, where: any, take: number): Promise<string[]> {
  const args = { where, select: { id: true }, orderBy: { id: 'asc' as const }, take }
  switch (type) {
    case 'INVOICE': return (await prisma.invoice.findMany(args)).map((r) => r.id)
    case 'DELIVERY_COGS': return (await prisma.order.findMany(args)).map((r) => r.id)
    case 'PAYMENT': return (await prisma.payment.findMany(args)).map((r) => r.id)
    case 'SALES_RETURN': return (await prisma.salesReturn.findMany(args)).map((r) => r.id)
    case 'PURCHASE_INVOICE': return (await prisma.purchaseInvoice.findMany(args)).map((r) => r.id)
    case 'SUPPLIER_PAYMENT': return (await prisma.supplierPayment.findMany(args)).map((r) => r.id)
    case 'SUPPLIER_RETURN': return (await prisma.supplierReturn.findMany(args)).map((r) => r.id)
  }
}

async function runOne(report: RebuildReport, type: SourceType, id: string) {
  report.total++
  try {
    const r = await syncInner(type, id)
    if (r.status === 'posted') { report.posted++; report.byType[type].posted++ }
    else if (r.status === 'removed') { report.removed++; report.byType[type].removed++ }
    else if (r.status === 'unchanged') { report.unchanged++; report.byType[type].unchanged++ }
    else { report.skipped.push({ type, id, reason: r.reason ?? 'skipped' }); report.byType[type].skipped++ }
  } catch (err) {
    report.errors.push({ type, id, error: err instanceof Error ? err.message : String(err) })
    report.byType[type].errors++
  }
}

/**
 * Processes at most `limit` sources (stable id order within each type, types in SOURCE_TYPES order, then an
 * ORPHANS step that clears auto entries whose source is gone or no longer qualifies). Call repeatedly with
 * the returned `next` until `done`.
 */
export async function rebuildChunk(opts: { type?: RebuildStep; after?: string | null; limit?: number } = {}): Promise<RebuildReport> {
  const settings = await getSettings(prisma)
  const report = emptyReport(settings.goLiveDate)
  if (!settings.goLiveDate) return report
  const from = settings.goLiveDate
  let remaining = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 40)))
  let stepIdx = opts.type ? STEPS.indexOf(opts.type) : 0
  if (stepIdx < 0) throw new Error(`Unknown rebuild step: ${opts.type}`)
  let after: string | null = opts.after ?? null

  while (stepIdx < STEPS.length) {
    const step = STEPS[stepIdx]
    if (step !== 'ORPHANS') {
      const where = { AND: [qualifying(step, from), after ? { id: { gt: after } } : {}] }
      const ids = await findIds(step, where, remaining)
      for (const id of ids) await runOne(report, step, id)
      remaining -= ids.length
      if (remaining <= 0) {
        // Limit reached inside this type: resume after the last processed id.
        report.done = false
        report.next = { type: step, after: ids[ids.length - 1] }
        return report
      }
      stepIdx++
      after = null
    } else {
      // after = "TYPE:ID" cursor over distinct auto (sourceType, sourceId) pairs.
      let curType = '', curId = ''
      if (after) { const i = after.indexOf(':'); curType = after.slice(0, i); curId = after.slice(i + 1) }
      const pairs = await prisma.journalEntry.findMany({
        where: {
          isManual: false,
          sourceType: { in: SOURCE_TYPES },
          sourceId: { not: null },
          ...(after ? { OR: [{ sourceType: { gt: curType } }, { sourceType: curType, sourceId: { gt: curId } }] } : {}),
        },
        select: { sourceType: true, sourceId: true },
        distinct: ['sourceType', 'sourceId'],
        orderBy: [{ sourceType: 'asc' }, { sourceId: 'asc' }],
        take: remaining,
      })
      const byType = new Map<SourceType, string[]>()
      for (const p of pairs) {
        const t = p.sourceType as SourceType
        byType.set(t, [...(byType.get(t) ?? []), p.sourceId as string])
      }
      for (const [t, list] of Array.from(byType.entries())) {
        const alive = new Set(await findIds(t, { AND: [qualifying(t, from), { id: { in: list } }] }, list.length))
        for (const sid of list) {
          if (alive.has(sid)) continue
          const before = report.removed
          await runOne(report, t, sid)
          if (report.removed > before) report.orphansRemoved++
        }
      }
      if (pairs.length >= remaining) {
        const last = pairs[pairs.length - 1]
        report.done = false
        report.next = { type: 'ORPHANS', after: `${last.sourceType}:${last.sourceId}` }
        return report
      }
      stepIdx++
    }
  }
  return report
}

function merge(into: RebuildReport, r: RebuildReport) {
  into.total += r.total; into.posted += r.posted; into.removed += r.removed; into.unchanged += r.unchanged
  into.orphansRemoved += r.orphansRemoved
  into.skipped.push(...r.skipped); into.errors.push(...r.errors)
  for (const k of Object.keys(r.byType)) for (const f of Object.keys(r.byType[k]) as (keyof RebuildReport['byType'][string])[]) into.byType[k][f] += r.byType[k][f]
}

/** Loops rebuildChunk to completion (scripts / QA). */
export async function rebuildAll(): Promise<RebuildReport> {
  const settings = await getSettings(prisma)
  const total = emptyReport(settings.goLiveDate)
  let next: { type?: RebuildStep; after?: string | null } = {}
  for (;;) {
    const r = await rebuildChunk({ ...next, limit: 100 })
    merge(total, r)
    if (r.done || !r.next) break
    next = r.next
  }
  return total
}
