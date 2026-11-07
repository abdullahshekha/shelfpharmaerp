export const AUDIT_EXCLUDED_MODELS: ReadonlySet<string> = new Set(['AuditLog', 'JournalLine', 'Notification'])

/** model -> fields whose values must never be logged. */
export const REDACTED_FIELDS: Record<string, string[]> = {
  Employee: ['passwordHash'],
  Retailer: ['portalPasswordHash'],
}

/** model -> fields whose sole change is not worth an audit row. */
export const NOISE_ONLY_FIELDS: Record<string, string[]> = {
  Retailer: ['portalFailedAttempts', 'portalLockedUntil', 'portalLastLoginAt'],
}

export function shouldAuditModel(model: string): boolean {
  return !AUDIT_EXCLUDED_MODELS.has(model)
}

export function shouldAuditRow(model: string, row: Record<string, unknown> | null): boolean {
  if (!shouldAuditModel(model)) return false
  if (model === 'JournalEntry') return row?.isManual === true
  return true
}
