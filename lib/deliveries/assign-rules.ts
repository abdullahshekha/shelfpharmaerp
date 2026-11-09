// Pure delivery-assignment rules (no Prisma imports), used by lib/deliveries/assign.ts and lib/orders/lifecycle.ts.
import { totalUnits } from '@/lib/orders/units'
import { restockQtyFor } from '@/lib/accounting/cost'

export const ASSIGN_ACTOR_ROLES = ['ADMIN', 'MANAGER'] as const
export const ASSIGNEE_ROLES = ['DRIVER', 'SALESMAN', 'SALES_REP', 'TEAM_LEAD'] as const
/** Order statuses a delivery can be assigned from (ON_HOLD = re-assignment, its stock is still out). */
export const ASSIGNABLE_STATUSES = ['INVOICED', 'ON_HOLD'] as const

export class AssignError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Only ADMIN/MANAGER may assign, un-assign or re-assign deliveries. */
export function canManageAssignments(role: string | null | undefined): boolean {
  return (ASSIGN_ACTOR_ROLES as readonly string[]).includes(role ?? '')
}

/** True when `role` (the actor's) may assign a delivery whose order is in `orderStatus`. */
export function canAssign(orderStatus: string, role: string | null | undefined): boolean {
  return canManageAssignments(role) && (ASSIGNABLE_STATUSES as readonly string[]).includes(orderStatus)
}

/** An Employee the delivery may be assigned to: active, with an assignee role. */
export function isValidAssignee(e: { isActive: boolean; role: string } | null | undefined): boolean {
  return !!e && e.isActive && (ASSIGNEE_ROLES as readonly string[]).includes(e.role)
}

/**
 * Whether a delivery that is OUT_FOR_DELIVERY already has an outcome for the current trip. Recording any outcome
 * moves the order out of OUT_FOR_DELIVERY, so the only outcome such a delivery can carry is ON_HOLD left from an
 * earlier trip (kept as history when the held order was re-assigned): that one does not count.
 */
export function hasCurrentOutcome(outcome: string | null | undefined): boolean {
  return !!outcome && outcome !== 'ON_HOLD'
}

export type DeductLine<T> = T & { units: number }

/**
 * Lines whose stock still has to come off the shelf at assignment: only those with a null/0 deductedQty (a line
 * already deducted, e.g. an On Hold order being re-assigned, is skipped). `units` = quantity + bonus (totalUnits).
 * Lines with nothing to ship (0 units) are left out.
 */
export function linesToDeduct<T extends { quantity: number; bonusQty?: number | null; deductedQty: number | null | undefined }>(
  items: T[],
): DeductLine<T>[] {
  return items
    .filter((i) => !i.deductedQty)
    .map((i) => ({ ...i, units: totalUnits(i) }))
    .filter((i) => i.units > 0)
}

/** Units needed per medicine for the given lines (several lines can share a medicine). */
export function unitsByMedicine(lines: { medicineId: string; units: number }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lines) m.set(l.medicineId, (m.get(l.medicineId) ?? 0) + l.units)
  return m
}

/**
 * Units of a line still out of the warehouse, i.e. what a cancel / un-assign / un-deliver puts back.
 * deductedQty is the single source of truth. A null deductedQty means "the ordered quantity" only on a legacy
 * DELIVERED row (delivered before deductedQty existed, see restockQtyFor); on any other status null means nothing
 * was ever deducted (e.g. an order converted from DISPATCHED that never took stock off the shelf).
 */
export function stillDeductedQty(orderStatus: string, item: { quantity: number; deductedQty: number | null | undefined }): number {
  if (item.deductedQty == null && orderStatus !== 'DELIVERED') return 0
  return restockQtyFor(item)
}
