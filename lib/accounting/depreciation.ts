// Straight-line monthly depreciation. Pure functions, all arithmetic in integer paisa.
//
// RULES
//  - The first depreciation month is the PURCHASE MONTH (a full month's charge, regardless of the day of month).
//  - Depreciable base = cost - salvage (<= 0 means nothing to depreciate).
//  - Each month = floor(base / life) paisa; the rounding remainder goes into the LAST month,
//    so the sum over the full life is exactly cost - salvage and never exceeds it.
//  - Months before the purchase month, after the useful life, and months after the disposal month yield 0.
//  - Opening assets (bought before go-live) carry `openingAccumulated` (depreciation booked before go-live). The
//    schedule itself is unchanged, but every month is capped so openingAccumulated + everything already posted
//    (`postedPaisa`) + this month never exceeds cost - salvage.
import { toPaisa, fromPaisa } from './money'

export interface DepreciableAsset {
  cost: number
  salvageValue: number
  usefulLifeMonths: number
  /** YYYY-MM of the purchase date (Asia/Karachi) */
  purchaseMonth: string
  /** YYYY-MM of the disposal date, if disposed */
  disposedMonth?: string | null
  /** Rupees of depreciation accumulated before go-live (opening assets only; default 0) */
  openingAccumulated?: number | null
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isValidMonth(m: unknown): m is string {
  return typeof m === 'string' && MONTH_RE.test(m)
}

/** Months from `from` to `to` (both YYYY-MM); negative when `to` is earlier. */
export function monthDiff(from: string, to: string): number {
  const a = MONTH_RE.exec(from)
  const b = MONTH_RE.exec(to)
  if (!a || !b) throw new Error('Invalid month')
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]))
}

/** Last calendar day of a YYYY-MM month as YYYY-MM-DD. */
export function lastDayOfMonth(month: string): string {
  const m = MONTH_RE.exec(month)
  if (!m) throw new Error('Invalid month')
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()
  return `${month}-${String(d).padStart(2, '0')}`
}

/** Depreciable amount still open (paisa): cost - salvage - openingAccumulated - already posted, never below 0. */
export function remainingDepreciablePaisa(asset: Pick<DepreciableAsset, 'cost' | 'salvageValue' | 'openingAccumulated'>, postedPaisa = 0): number {
  const base = toPaisa(asset.cost) - toPaisa(asset.salvageValue)
  return Math.max(0, base - toPaisa(asset.openingAccumulated ?? 0) - Math.max(0, postedPaisa))
}

/**
 * Depreciation charge for `month` in integer paisa. `postedPaisa` = depreciation already posted for the asset
 * (excluding this month); together with `openingAccumulated` it caps the charge so the total never exceeds
 * cost - salvage. Both default to 0, which leaves the plain straight-line schedule.
 */
export function depreciationPaisa(asset: DepreciableAsset, month: string, postedPaisa = 0): number {
  const base = toPaisa(asset.cost) - toPaisa(asset.salvageValue)
  const life = Math.floor(asset.usefulLifeMonths)
  if (base <= 0 || !(life >= 1)) return 0
  if (asset.disposedMonth && monthDiff(asset.disposedMonth, month) > 0) return 0
  const k = monthDiff(asset.purchaseMonth, month)
  if (k < 0 || k >= life) return 0
  const per = Math.floor(base / life)
  const scheduled = k < life - 1 ? per : base - per * (life - 1)
  return Math.min(scheduled, remainingDepreciablePaisa(asset, postedPaisa))
}

/** Depreciation charge for `month` in rupees. */
export function monthlyDepreciation(asset: DepreciableAsset, month: string): number {
  return fromPaisa(depreciationPaisa(asset, month))
}

/** The regular (non-final) monthly amount in rupees, for display in the register. */
export function regularMonthlyAmount(asset: Pick<DepreciableAsset, 'cost' | 'salvageValue' | 'usefulLifeMonths'>): number {
  const base = toPaisa(asset.cost) - toPaisa(asset.salvageValue)
  const life = Math.floor(asset.usefulLifeMonths)
  if (base <= 0 || !(life >= 1)) return 0
  return fromPaisa(Math.floor(base / life))
}

/** YYYY-MM shifted by `k` months (k may be negative). */
export function addMonths(month: string, k: number): string {
  const m = MONTH_RE.exec(month)
  if (!m) throw new Error('Invalid month')
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + k
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/**
 * Months (inclusive) a catch-up run should consider for one asset: from its first depreciation month (the
 * purchase month, but never before the go-live month) through the requested month, capped at the last month of
 * its useful life. Empty when nothing is due.
 */
export function catchUpMonths(
  asset: { purchaseMonth: string; usefulLifeMonths: number } & Partial<Pick<DepreciableAsset, 'cost' | 'salvageValue' | 'openingAccumulated'>>,
  goLiveMonth: string,
  requested: string,
): string[] {
  // An opening asset whose pre-go-live depreciation already covers the whole depreciable amount has nothing due.
  if (asset.cost !== undefined && asset.salvageValue !== undefined && toPaisa(asset.openingAccumulated ?? 0) > 0 && remainingDepreciablePaisa(asset as DepreciableAsset) <= 0) return []
  const first = monthDiff(asset.purchaseMonth, goLiveMonth) > 0 ? goLiveMonth : asset.purchaseMonth
  const lastOfLife = addMonths(asset.purchaseMonth, Math.floor(asset.usefulLifeMonths) - 1)
  const last = monthDiff(lastOfLife, requested) > 0 ? lastOfLife : requested
  const out: string[] = []
  for (let m = first; monthDiff(m, last) >= 0; m = addMonths(m, 1)) out.push(m)
  return out
}
