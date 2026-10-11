// Date input helpers for the accounts APIs. Timezone-less inputs are Asia/Karachi (UTC+5).

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

function realCalendarDay(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** Parses an ISO date/datetime (bare day or timezone-less datetime = Karachi). Returns null when invalid. */
export function parseDateInput(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null
  const day = DAY_ONLY.exec(v)
  const naive = NAIVE_DATETIME.exec(v)
  const m = day ?? naive
  if (m && !realCalendarDay(Number(m[1]), Number(m[2]), Number(m[3]))) return null
  const d = new Date(day ? `${v}T00:00:00+05:00` : naive ? `${v}+05:00` : v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Exclusive upper bound for an inclusive `to` day filter. */
export function endExclusive(v: unknown): Date | null {
  const d = parseDateInput(v)
  if (!d) return null
  return typeof v === 'string' && DAY_ONLY.test(v) ? new Date(d.getTime() + 86400000) : d
}
