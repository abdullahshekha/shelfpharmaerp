import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseDateInput, endExclusive } from '@/lib/accounting/dates'

export type AuditFilter = {
  actorId?: string
  model?: string
  action?: string
  /** YYYY-MM-DD Karachi day, inclusive */
  from?: string
  /** YYYY-MM-DD Karachi day, inclusive */
  to?: string
  recordIds?: string[]
}

/** Pure query builder. Invalid dates are ignored (routes validate and 400 before calling). */
export function buildAuditWhere(f: AuditFilter): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {}
  if (f.actorId) where.actorId = f.actorId
  if (f.model) where.model = f.model
  if (f.action) where.action = f.action
  const from = f.from ? parseDateInput(f.from) : null
  const to = f.to ? endExclusive(f.to) : null
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) }
  if (f.recordIds) where.recordId = { in: f.recordIds }
  return where
}

/** Every record id that belongs to an order: the order, its items, invoice, delivery, challan and the invoice's payments. */
export async function orderRecordIds(orderId: string): Promise<string[]> {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      items: { select: { id: true } },
      invoice: { select: { id: true, payments: { select: { id: true } } } },
      delivery: { select: { id: true } },
    },
  })
  const ch = await prisma.deliveryChallan.findUnique({ where: { orderId }, select: { id: true } })
  const ids = new Set<string>([orderId])
  if (o) {
    o.items.forEach((i) => ids.add(i.id))
    if (o.invoice) { ids.add(o.invoice.id); o.invoice.payments.forEach((p) => ids.add(p.id)) }
    if (o.delivery) ids.add(o.delivery.id)
  }
  if (ch) ids.add(ch.id)
  return Array.from(ids)
}

/**
 * Resolves the free-text `q` of the audit log search to record ids.
 * Order number (SP-YYYYMMDD-XXXX) or invoice number (SP-INV-...) -> all ids of that order (empty list = no match);
 * anything else is treated as an exact record id.
 */
export async function resolveSearchIds(q: string): Promise<string[]> {
  const s = q.trim()
  if (/^SP-INV-/i.test(s)) {
    const inv = await prisma.invoice.findUnique({ where: { invoiceNumber: s.toUpperCase() }, select: { orderId: true } })
    return inv ? orderRecordIds(inv.orderId) : []
  }
  if (/^SP-\d/i.test(s)) {
    const o = await prisma.order.findUnique({ where: { orderNumber: s.toUpperCase() }, select: { id: true } })
    return o ? orderRecordIds(o.id) : []
  }
  return [s]
}

/**
 * Order history filter: entries for any of the order's records, OR entries whose `_cascaded` snapshot
 * (written when a parent delete cascades, see cascade.ts) lists one of the order's OrderItems — chosen as a
 * Prisma JSON `array_contains` on `changes` path ['_cascaded','OrderItem'] matching `{ orderId }`.
 */
export function orderHistoryWhere(orderId: string, ids: string[]): Prisma.AuditLogWhereInput {
  return {
    OR: [
      { recordId: { in: ids } },
      { changes: { path: ['_cascaded', 'OrderItem'], array_contains: [{ orderId }] } },
    ],
  }
}
