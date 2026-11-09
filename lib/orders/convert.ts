// Pure planner for scripts/convert-order-statuses.ts (no Prisma, no I/O).
import { isOrderStatus, mapOldStatus, type OrderStatus } from '@/lib/orders/status'

export interface ConvertRow {
  id: string
  orderNumber: string
  status: string
  deliveryStatus: string | null
  items: { deductedQty: number | null }[]
}
export interface ConvertUpdate { id: string; orderNumber: string; from: string; to: OrderStatus; deliveryStatus: 'SCHEDULED' | null }
export interface ConvertPlan {
  updates: ConvertUpdate[]
  deletes: string[]
  /** Orders that become OUT_FOR_DELIVERY although no stock was ever deducted: need a human decision. */
  review: { id: string; orderNumber: string; reason: string }[]
  counts: Record<string, number>
}

export function planConversion(rows: ConvertRow[]): ConvertPlan {
  const plan: ConvertPlan = { updates: [], deletes: [], review: [], counts: {} }
  for (const r of rows) {
    plan.counts[r.status] = (plan.counts[r.status] ?? 0) + 1
    // Statuses that already exist in the new vocabulary (and are not legacy aliases) need no change.
    if (r.status !== 'PENDING' && isOrderStatus(r.status)) continue
    const to = mapOldStatus(r.status)
    if (to === 'DELETE') { plan.deletes.push(r.id); continue }
    if (to === r.status) continue
    plan.updates.push({ id: r.id, orderNumber: r.orderNumber, from: r.status, to, deliveryStatus: to === 'INVOICED' ? 'SCHEDULED' : null })
    if (to === 'OUT_FOR_DELIVERY' && r.items.some((i) => i.deductedQty === null)) {
      plan.review.push({ id: r.id, orderNumber: r.orderNumber, reason: 'was DISPATCHED but stock was never deducted (the old code deducted at DELIVERED); deduct or revert manually' })
    }
  }
  return plan
}
