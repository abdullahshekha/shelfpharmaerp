// Straight-line monthly depreciation. Pure functions, all arithmetic in integer paisa.
//
// RULES
//  - The first depreciation month is the PURCHASE MONTH (a full month's charge, regardless of the day of month).
//  - Depreciable base = cost - salvage (<= 0 means nothing to depreciate).
//  - Each month = floor(base / life) paisa; the rounding remainder goes into the LAST month,
//    so the sum over the full life is exactly cost - salvage and never exceeds it.
//  - Months before the purchase month, after the useful life, and months after the disposal month yield 0.
import { toPaisa, fromPaisa } from './money'

export interface DepreciableAsset {
  cost: number
  salvageValue: number
  usefulLifeMonths: number
  /** YYYY-MM of the purchase date (Asia/Karachi) */
  purchaseMonth: string
  /** YYYY-MM of the disposal date, if disposed */
  disposedMonth?: string | null
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

/** Depreciation charge for `month` in integer paisa. */
export function depreciationPaisa(asset: DepreciableAsset, month: string): number {
  const base = toPaisa(asset.cost) - toPaisa(asset.salvageValue)
  const life = Math.floor(asset.usefulLifeMonths)
  if (base <= 0 || !(life >= 1)) return 0
  if (asset.disposedMonth && monthDiff(asset.disposedMonth, month) > 0) return 0
  const k = monthDiff(asset.purchaseMonth, month)
  if (k < 0 || k >= life) return 0
  const per = Math.floor(base / life)
  return k < life - 1 ? per : base - per * (life - 1)
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
