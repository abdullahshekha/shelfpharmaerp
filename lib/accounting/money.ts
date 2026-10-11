// Money helpers: all balance checks are done in integer paisa to avoid float drift.

/** Convert rupees to integer paisa (half away from zero, tolerant of float noise like 1.005). */
export function toPaisa(n: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) throw new Error(`Invalid amount: ${n}`)
  const sign = v < 0 ? -1 : 1
  return sign * Math.round(Math.abs(v) * 100 + 1e-7)
}

export function fromPaisa(p: number): number {
  return p / 100
}

export function round2(n: number): number {
  return fromPaisa(toPaisa(n))
}
