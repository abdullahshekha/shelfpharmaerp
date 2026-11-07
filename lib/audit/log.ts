import { prisma } from '@/lib/prisma'
import { getCurrentActor, type AuditActor } from './actor'
import { auditRowData } from './extension'

/** Direct insert for event-type entries (logins), which have no business write to ride along with. */
export async function logAuditEvent(e: {
  action: 'LOGIN' | 'LOGIN_FAILED'
  actor?: AuditActor
  model?: string
  recordId?: string | null
  changes?: Record<string, unknown>
  reason?: string
}): Promise<void> {
  // Test-only failure switch (never active in production), mirrors AUDIT_TEST_FAIL in extension.ts.
  if (process.env.NODE_ENV !== 'production' && process.env.AUDIT_TEST_FAIL_EVENT === '1') throw new Error('forced audit event failure')
  await prisma.auditLog.create({
    data: auditRowData(e.actor ?? getCurrentActor(), {
      model: e.model ?? 'Auth',
      recordId: e.recordId ?? null,
      action: e.action,
      changes: e.changes ?? null,
      reason: e.reason ?? null,
    }),
  })
}

/** Login variant: an audit insert failure is logged and swallowed so it can never block or alter a login response. */
export async function logLoginEvent(e: Parameters<typeof logAuditEvent>[0]): Promise<void> {
  try {
    await logAuditEvent(e)
  } catch (err) {
    console.error('[audit] failed to log login event', err)
  }
}
