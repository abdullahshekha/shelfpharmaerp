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
