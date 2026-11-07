import { NOISE_ONLY_FIELDS, REDACTED_FIELDS } from './config'

export type FieldChange = { from: unknown; to: unknown }

const HIDDEN = '[hidden]'

function isDecimal(v: unknown): boolean {
  return typeof v === 'object' && v !== null && typeof (v as { toFixed?: unknown }).toFixed === 'function'
}

export function toJsonSafe(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null
  if (typeof v === 'bigint') return v.toString()
  if (v instanceof Date) return v.toISOString()
  if (isDecimal(v)) return String(v)
  if (Array.isArray(v)) return v.map(toJsonSafe)
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = toJsonSafe(val)
    return out
  }
  return v
}

function redactDeep(v: unknown, fields: string[]): unknown {
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, fields))
  if (v && typeof v === 'object' && !(v instanceof Date) && !isDecimal(v)) {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = fields.includes(k) ? HIDDEN : redactDeep(val, fields)
    }
    return out
  }
  return v
}

export function redact(model: string, values: Record<string, unknown>): Record<string, unknown> {
  const fields = REDACTED_FIELDS[model]
  if (!fields?.length) return values
  return redactDeep(values, fields) as Record<string, unknown>
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isDecimal(a) && isDecimal(b)) return Number(a) === Number(b)
  return JSON.stringify(toJsonSafe(a)) === JSON.stringify(toJsonSafe(b))
}

export function diffRecords(
  model: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {}
  const hidden = REDACTED_FIELDS[model] ?? []
  const present = (k: string, v: unknown) => (hidden.includes(k) ? HIDDEN : toJsonSafe(v))

  if (!before && !after) return changes
  if (!before || !after) {
    const row = (before ?? after)!
    for (const [k, v] of Object.entries(row)) {
      if (k === 'updatedAt') continue
      changes[k] = before ? { from: present(k, v), to: null } : { from: null, to: present(k, v) }
    }
    return changes
  }
  for (const k of Array.from(new Set(Object.keys(before).concat(Object.keys(after))))) {
    if (k === 'updatedAt') continue
    if (!sameValue(before[k], after[k])) {
      changes[k] = hidden.includes(k)
        ? { from: HIDDEN, to: HIDDEN }
        : { from: toJsonSafe(before[k]), to: toJsonSafe(after[k]) }
    }
  }
  return changes
}

export function isNoiseOnly(model: string, changes: Record<string, FieldChange>): boolean {
  const noise = NOISE_ONLY_FIELDS[model]
  const keys = Object.keys(changes)
  return !!noise && keys.length > 0 && keys.every((k) => noise.includes(k))
}
