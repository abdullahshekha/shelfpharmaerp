// Idempotent sync engine: (sourceType, sourceId) -> the auto journal entries that record's current state implies.
// syncSource deletes all auto entries for the source and recreates them, inside one transaction guarded by a
// per-source advisory lock. Business routes call syncSafe AFTER their own transaction commits.
import { prisma } from '@/lib/prisma'
import { assertNotLocked, getSettings, postEntry } from './core'
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

export type SyncResult = { status: 'posted' | 'removed' | 'skipped'; reason?: string }

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
type Loaded = { date: Date; entries: BuiltEntry[] } | null

const n = (v: unknown) => Number(v ?? 0)

/** Loads the record and maps it to builder output. Returns null when the record no longer exists. */
async function load(tx: Tx, type: SourceType, id: string): Promise<Loaded> {
  switch (type) {
    case 'INVOICE': {
      const r = await tx.invoice.findUnique({ where: { id } })
      if (!r) return null
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

/** Throws on builder/data errors (callers classify). */
async function syncInner(type: SourceType, id: string): Promise<SyncResult> {
  return prisma.$transaction(
    async (tx): Promise<SyncResult> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${type + ':' + id}))`
      const settings = await getSettings(tx)
      if (!settings.goLiveDate) return { status: 'skipped', reason: 'no go-live date set' }

      const existing = await tx.journalEntry.findMany({
        where: { sourceType: type, sourceId: id, isManual: false },
        select: { id: true, date: true },
      })
      for (const e of existing) {
        try {
          assertNotLocked(settings, e.date)
        } catch {
          return { status: 'skipped', reason: 'existing entries are in a locked period' }
        }
      }

      const loaded = await load(tx, type, id)
      let entries: BuiltEntry[] = []
      let reason: string | undefined
      if (loaded) {
        if (loaded.date.getTime() < settings.goLiveDate.getTime()) {
          reason = 'dated before go-live'
        } else {
          entries = loaded.entries
          for (const e of entries) {
            try {
              assertNotLocked(settings, e.date)
            } catch {
              return { status: 'skipped', reason: 'dated in a locked period' }
            }
          }
        }
      }

      if (existing.length) await tx.journalEntry.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } })
      for (const e of entries) {
        await postEntry(tx, { date: e.date, memo: e.memo, sourceType: type, sourceId: id, isManual: false, lines: e.lines })
      }
      if (entries.length) return { status: 'posted' }
      if (reason) return existing.length ? { status: 'removed', reason } : { status: 'skipped', reason }
      return { status: 'removed' }
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

export interface RebuildReport {
  goLiveDate: string | null
  total: number
  posted: number
  removed: number
  skipped: { type: SourceType; id: string; reason: string }[]
  errors: { type: SourceType; id: string; error: string }[]
  byType: Record<string, { posted: number; removed: number; skipped: number; errors: number }>
}

async function idsSince(type: SourceType, from: Date): Promise<string[]> {
  switch (type) {
    case 'INVOICE':
      return (await prisma.invoice.findMany({ where: { invoiceDate: { gte: from } }, select: { id: true } })).map((r) => r.id)
    case 'DELIVERY_COGS':
      return (await prisma.order.findMany({ where: { status: 'DELIVERED' }, select: { id: true } })).map((r) => r.id)
    case 'PAYMENT':
      return (await prisma.payment.findMany({ where: { paymentDate: { gte: from } }, select: { id: true } })).map((r) => r.id)
    case 'SALES_RETURN':
      return (await prisma.salesReturn.findMany({ where: { returnDate: { gte: from } }, select: { id: true } })).map((r) => r.id)
    case 'PURCHASE_INVOICE':
      return (await prisma.purchaseInvoice.findMany({ where: { invoiceDate: { gte: from } }, select: { id: true } })).map((r) => r.id)
    case 'SUPPLIER_PAYMENT':
      return (await prisma.supplierPayment.findMany({ where: { paymentDate: { gte: from } }, select: { id: true } })).map((r) => r.id)
    case 'SUPPLIER_RETURN':
      return (await prisma.supplierReturn.findMany({ where: { returnDate: { gte: from } }, select: { id: true } })).map((r) => r.id)
  }
}

/** Re-syncs every source dated since go-live, plus any orphaned auto entries whose source is gone. */
export async function rebuildAll(): Promise<RebuildReport> {
  const settings = await getSettings(prisma)
  const report: RebuildReport = {
    goLiveDate: settings.goLiveDate ? settings.goLiveDate.toISOString() : null,
    total: 0,
    posted: 0,
    removed: 0,
    skipped: [],
    errors: [],
    byType: {},
  }
  if (!settings.goLiveDate) return report

  const targets: [SourceType, string][] = []
  const seen = new Set<string>()
  for (const t of SOURCE_TYPES) {
    for (const id of await idsSince(t, settings.goLiveDate)) {
      targets.push([t, id])
      seen.add(`${t}:${id}`)
    }
  }
  // Orphans: auto entries whose source is deleted / now dated before go-live.
  const existing = await prisma.journalEntry.findMany({
    where: { isManual: false, sourceType: { in: SOURCE_TYPES }, sourceId: { not: null } },
    select: { sourceType: true, sourceId: true },
    distinct: ['sourceType', 'sourceId'],
  })
  for (const e of existing) {
    const key = `${e.sourceType}:${e.sourceId}`
    if (!seen.has(key)) {
      seen.add(key)
      targets.push([e.sourceType as SourceType, e.sourceId as string])
    }
  }

  for (const t of SOURCE_TYPES) report.byType[t] = { posted: 0, removed: 0, skipped: 0, errors: 0 }
  for (const [type, id] of targets) {
    report.total++
    try {
      const r = await syncInner(type, id)
      if (r.status === 'posted') {
        report.posted++
        report.byType[type].posted++
      } else if (r.status === 'removed') {
        report.removed++
        report.byType[type].removed++
      } else {
        report.skipped.push({ type, id, reason: r.reason ?? 'skipped' })
        report.byType[type].skipped++
      }
    } catch (err) {
      report.errors.push({ type, id, error: err instanceof Error ? err.message : String(err) })
      report.byType[type].errors++
    }
  }
  return report
}
