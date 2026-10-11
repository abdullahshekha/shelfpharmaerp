// Date input helpers for the accounts APIs. Bare YYYY-MM-DD strings are Asia/Karachi calendar days.

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Parses an ISO date/datetime; a bare YYYY-MM-DD means midnight Karachi. Returns null when invalid. */
export function parseDateInput(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(DAY_ONLY.test(v) ? `${v}T00:00:00+05:00` : v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Exclusive upper bound for an inclusive `to` day filter. */
export function endExclusive(v: unknown): Date | null {
  const d = parseDateInput(v)
  if (!d) return null
  return typeof v === 'string' && DAY_ONLY.test(v) ? new Date(d.getTime() + 86400000) : d
}
