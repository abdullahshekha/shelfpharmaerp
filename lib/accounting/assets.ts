/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared helpers for the Fixed Assets routes.
//
// Ledger footprint of an asset (all isManual=false, so neither the manual-journal reversal route nor
// sync/rebuild touch them — sync and rebuild's orphan cleanup only handle the 7 SOURCE_TYPES in sync.ts):
//   ASSET_PURCHASE  sourceId = asset id               Dr FIXED_ASSETS / Cr funding account
//   ASSET_PURCHASE  sourceId = `opening:${assetId}`   opening asset (bought before go-live), dated the go-live date:
//                   Dr FIXED_ASSETS cost / Cr ACCUM_DEPRECIATION openingAccumulated / Cr OPENING_EQUITY the rest
//   DEPRECIATION    sourceId = `${assetId}:${YYYY-MM}` Dr DEPRECIATION_EXPENSE / Cr ACCUM_DEPRECIATION
//   ASSET_DISPOSAL  sourceId = asset id               Dr ACCUM_DEPRECIATION, Dr OTHER_EXPENSES / Cr FIXED_ASSETS
// Every mutation of one asset (add/edit/delete/dispose/depreciate) takes the same advisory lock.
import { prisma } from '@/lib/prisma'
import { ensureChart } from './accounts'
import { AccountingError, karachiDayKey, postEntry, type LineInput } from './core'
import { regularMonthlyAmount } from './depreciation'
import { toPaisa } from './money'
import { parseDateInput } from './dates'

export const MAX_COST = 1e9
export const MAX_LIFE_MONTHS = 1200

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export const lockAsset = (tx: Tx, id: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'FIXED_ASSET:' + id}))`

/** YYYY-MM of an instant in Asia/Karachi. */
export function karachiMonth(d: Date): string {
  const k = karachiDayKey(d)
  return `${k.slice(0, 4)}-${k.slice(4, 6)}`
}

/** Accounts that may fund an asset purchase: cash/bank, or an active liability/equity account other than AR/AP. */
export function isValidFundingAccount(a: { type: string; subType: string | null; systemKey: string | null; isActive: boolean }): string | null {
  if (!a.isActive) return 'The funding account is inactive'
  if (a.systemKey === 'AR' || a.systemKey === 'AP' || a.subType === 'RECEIVABLE' || a.subType === 'PAYABLE') {
    return 'Receivable/payable accounts need a customer or supplier — choose a cash, bank, liability or equity account'
  }
  if (a.type === 'ASSET' && (a.subType === 'CASH' || a.subType === 'BANK')) return null
  if (a.type === 'LIABILITY' || a.type === 'EQUITY') return null
  return 'Funding account must be a cash/bank account or a liability/equity account'
}

export interface AssetFields {
  name: string
  category: string | null
  notes: string | null
  purchaseDate: Date
  cost: number
  salvageValue: number
  usefulLifeMonths: number
  paidFromAccountId: string
  /** opening assets only: depreciation accumulated before go-live (rupees) */
  openingAccumulated?: number
}

export const openingSourceId = (assetId: string) => `opening:${assetId}`
/** Every ASSET_PURCHASE sourceId an asset may have (normal purchase or opening entry). */
export const purchaseSourceIds = (assetId: string) => [assetId, openingSourceId(assetId)]

function bad(msg: string): never {
  throw new AccountingError(400, msg)
}

/** Validates a create body (or the financial/descriptive fields of an edit body when `partial`). */
export function parseAssetBody(body: any, partial: boolean, opts: { opening?: boolean } = {}): Partial<AssetFields> {
  if (!body || typeof body !== 'object') bad('Invalid JSON')
  const out: Partial<AssetFields> = {}
  const has = (k: string) => body[k] !== undefined
  if (!partial || has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) bad('Name is required')
    if (name.length > 200) bad('Name is too long')
    out.name = name
  }
  if (!partial || has('category')) {
    if (body.category != null && typeof body.category !== 'string') bad('Invalid category')
    const c = typeof body.category === 'string' ? body.category.trim() : ''
    if (c.length > 100) bad('Category is too long')
    out.category = c || null
  }
  if (!partial || has('notes')) {
    if (body.notes != null && typeof body.notes !== 'string') bad('Invalid notes')
    const n = typeof body.notes === 'string' ? body.notes.trim() : ''
    if (n.length > 1000) bad('Notes are too long')
    out.notes = n || null
  }
  if (!partial || has('purchaseDate')) {
    const d = parseDateInput(body.purchaseDate)
    if (!d) bad('Invalid purchase date')
    out.purchaseDate = d
  }
  if (!partial || has('cost')) {
    if (typeof body.cost !== 'number' || !Number.isFinite(body.cost)) bad('Cost must be a number')
    if (body.cost > MAX_COST) bad(`Cost must not exceed ${MAX_COST.toLocaleString('en-US')}`)
    const p = toPaisa(body.cost)
    if (p <= 0) bad('Cost must be greater than zero')
    out.cost = p / 100
  }
  if (!partial || has('salvageValue')) {
    const raw = body.salvageValue ?? 0
    if (typeof raw !== 'number' || !Number.isFinite(raw)) bad('Salvage value must be a number')
    if (raw < 0) bad('Salvage value cannot be negative')
    if (raw > MAX_COST) bad('Salvage value is too large')
    out.salvageValue = toPaisa(raw) / 100
  }
  if (!partial || has('usefulLifeMonths')) {
    const l = body.usefulLifeMonths
    if (typeof l !== 'number' || !Number.isInteger(l) || l < 1 || l > MAX_LIFE_MONTHS) bad(`Useful life must be a whole number of months between 1 and ${MAX_LIFE_MONTHS}`)
    out.usefulLifeMonths = l
  }
  if (opts.opening) {
    // Opening assets have no funding account: the credit goes to Opening Balance Equity.
    const raw = body.openingAccumulated ?? 0
    if (typeof raw !== 'number' || !Number.isFinite(raw)) bad('Accumulated depreciation must be a number')
    if (raw < 0) bad('Accumulated depreciation cannot be negative')
    if (raw > MAX_COST) bad('Accumulated depreciation is too large')
    out.openingAccumulated = toPaisa(raw) / 100
  } else if (!partial || has('paidFromAccountId')) {
    if (typeof body.paidFromAccountId !== 'string' || !body.paidFromAccountId) bad('Funding account is required')
    out.paidFromAccountId = body.paidFromAccountId
  }
  if (out.cost !== undefined && out.salvageValue !== undefined && out.salvageValue >= out.cost) bad('Salvage value must be less than the cost')
  if (opts.opening && out.cost !== undefined && out.salvageValue !== undefined && out.openingAccumulated !== undefined) {
    if (toPaisa(out.openingAccumulated) > toPaisa(out.cost) - toPaisa(out.salvageValue)) bad('Accumulated depreciation cannot exceed cost minus salvage value')
  }
  return out
}

/** Posts the ASSET_PURCHASE entry (Dr FIXED_ASSETS / Cr funding account) inside `tx`. */
export async function postAssetPurchase(tx: Tx, asset: { id: string; name: string; purchaseDate: Date; cost: any }, fundingId: string, userId?: string) {
  const chart = await ensureChart(tx)
  const cost = Number(asset.cost)
  return postEntry(tx, {
    date: asset.purchaseDate,
    memo: `Fixed asset purchase: ${asset.name}`,
    sourceType: 'ASSET_PURCHASE',
    sourceId: asset.id,
    isManual: false,
    createdById: userId,
    lines: [
      { accountId: chart.FIXED_ASSETS, debit: cost },
      { accountId: fundingId, credit: cost },
    ],
  })
}

/**
 * Posts the opening entry of an asset bought before go-live (sourceId `opening:<id>`), dated `date` (the go-live
 * date): Dr FIXED_ASSETS cost / Cr ACCUM_DEPRECIATION openingAccumulated (if > 0) / Cr OPENING_EQUITY the rest (if > 0).
 */
export async function postOpeningAsset(tx: Tx, asset: { id: string; name: string; cost: any; openingAccumulated: any }, date: Date, userId?: string) {
  const chart = await ensureChart(tx)
  const costP = toPaisa(Number(asset.cost))
  const accP = toPaisa(Number(asset.openingAccumulated ?? 0))
  const lines: LineInput[] = [{ accountId: chart.FIXED_ASSETS, debit: costP / 100 }]
  if (accP > 0) lines.push({ accountId: chart.ACCUM_DEPRECIATION, credit: accP / 100 })
  if (costP - accP > 0) lines.push({ accountId: chart.OPENING_EQUITY, credit: (costP - accP) / 100 })
  return postEntry(tx, {
    date,
    memo: `Opening fixed asset: ${asset.name}`,
    sourceType: 'ASSET_PURCHASE',
    sourceId: openingSourceId(asset.id),
    isManual: false,
    createdById: userId,
    lines,
  })
}

/** Accumulated depreciation (paisa), number of depreciation entries and latest entry date per asset, from the ledger. */
export async function depreciationSummary(db: Pick<Tx, 'journalEntry' | 'account'>, assetIds?: string[]) {
  const chart = await ensureChart(db as any)
  const entries = await db.journalEntry.findMany({
    where: {
      sourceType: 'DEPRECIATION',
      ...(assetIds && assetIds.length === 1 ? { sourceId: { startsWith: `${assetIds[0]}:` } } : {}),
    },
    select: { sourceId: true, date: true, lines: { where: { accountId: chart.ACCUM_DEPRECIATION }, select: { debit: true, credit: true } } },
  })
  const map = new Map<string, { paisa: number; count: number; last: Date | null; months: Set<string> }>()
  for (const e of entries) {
    const [aid, month] = (e.sourceId ?? '').split(':')
    if (!aid) continue
    const cur = map.get(aid) ?? { paisa: 0, count: 0, last: null, months: new Set<string>() }
    for (const l of e.lines) cur.paisa += toPaisa(Number(l.credit)) - toPaisa(Number(l.debit))
    cur.count++
    cur.months.add(month)
    if (!cur.last || e.date > cur.last) cur.last = e.date
    map.set(aid, cur)
  }
  return map
}

export function assetView(a: any, dep?: { paisa: number; count: number; last: Date | null }) {
  const cost = Number(a.cost)
  const salvage = Number(a.salvageValue)
  // Accumulated = depreciation booked before go-live (opening assets) + depreciation posted in the ledger.
  const openingP = toPaisa(Number(a.openingAccumulated ?? 0))
  const accumP = openingP + (dep?.paisa ?? 0)
  const accumulated = accumP / 100
  const disposed = a.status === 'DISPOSED'
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    notes: a.notes,
    purchaseDate: a.purchaseDate,
    cost,
    salvageValue: salvage,
    usefulLifeMonths: a.usefulLifeMonths,
    status: a.status,
    disposedAt: a.disposedAt,
    paidFromAccountId: a.paidFromAccountId,
    monthlyDepreciation: disposed ? 0 : regularMonthlyAmount({ cost, salvageValue: salvage, usefulLifeMonths: a.usefulLifeMonths }),
    accumulatedDepreciation: accumulated,
    // Book value is zero once disposed (the asset left the books).
    bookValue: disposed ? 0 : (toPaisa(cost) - accumP) / 100,
    isOpening: !!a.isOpening,
    openingAccumulated: openingP / 100,
    depreciationEntries: dep?.count ?? 0,
    lastDepreciationDate: dep?.last ?? null,
  }
}
