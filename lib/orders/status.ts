// Pure order-status rules (no Prisma imports). Statuses are plain Strings in the DB.
import { karachiDayKey } from '@/lib/accounting/core'

export const ORDER_STATUSES = [
  'RECEIVED', 'INVOICED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'RETURNED', 'CANCELLED',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Statuses in which the order's stock has physically left the warehouse. */
export const STOCK_OUT_STATUSES: readonly OrderStatus[] = ['OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'RETURNED']

export function isOrderStatus(s: string): s is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(s)
}

/** Map a legacy status to the new set. DRAFT has no equivalent and is deleted by the migration. */
export function mapOldStatus(old: string): OrderStatus | 'DELETE' {
  switch (old) {
    case 'PENDING': return 'RECEIVED'
    case 'CONFIRMED':
    case 'PICKING': return 'INVOICED'
    case 'DISPATCHED': return 'OUT_FOR_DELIVERY'
    case 'DELIVERED': return 'DELIVERED'
    case 'CANCELLED': return 'CANCELLED'
    case 'DRAFT': return 'DELETE'
    default: throw new Error(`Unknown legacy order status: ${old}`)
  }
}

const MOVES: Record<OrderStatus, readonly OrderStatus[]> = {
  RECEIVED: ['INVOICED', 'CANCELLED'],
  INVOICED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNED', 'ON_HOLD', 'INVOICED', 'CANCELLED'],
  ON_HOLD: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  // Final: changed only through the existing admin paths (cancel/delete/un-deliver), not by canMove.
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
}

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return MOVES[from].includes(to)
}

export type BoardColumn = 'READY' | 'ASSIGNED' | 'DELIVERED' | 'RETURNED' | 'ON_HOLD'

/**
 * Which Deliveries-board column an order belongs in, or null if it is not on the board.
 * INVOICED (and ON_HOLD whose date has arrived) -> READY, OUT_FOR_DELIVERY -> ASSIGNED, DELIVERED, RETURNED.
 * ON_HOLD with a future held-until date -> ON_HOLD column. Days compare as Karachi calendar days.
 */
export function boardColumn(
  order: { status: string },
  delivery: { scheduledDate: Date },
  now: Date,
): BoardColumn | null {
  switch (order.status) {
    case 'INVOICED': return 'READY'
    case 'OUT_FOR_DELIVERY': return 'ASSIGNED'
    case 'DELIVERED': return 'DELIVERED'
    case 'RETURNED': return 'RETURNED'
    case 'ON_HOLD':
      // Held-until day has arrived (Karachi) -> back in Ready to Dispatch; still in the future -> On Hold column.
      return karachiDayKey(delivery.scheduledDate) <= karachiDayKey(now) ? 'READY' : 'ON_HOLD'
    default: return null
  }
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  RECEIVED: 'Order Received',
  INVOICED: 'Invoice Generated',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  ON_HOLD: 'On Hold',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled',
}

/** Label for any stored status (falls back to the raw value for unknown/legacy ones). */
export function orderStatusLabel(s: string): string {
  return isOrderStatus(s) ? ORDER_STATUS_LABEL[s] : s
}

/** The generic status route only does RECEIVED -> INVOICED ("Confirm") and cancel; every other move goes through the delivery functions. */
export function canSetViaStatusRoute(to: string): boolean {
  return to === 'INVOICED' || to === 'CANCELLED'
}

/**
 * Who may use the generic status route: INVOICED ("Confirm") is ADMIN/MANAGER, CANCELLED is ADMIN only (a manager
 * cancels through the delete-approval flow). Returns the 403 to send, or null when allowed.
 */
export function statusRouteRoleError(to: string, role: string | null | undefined): { status: 403; message: string } | null {
  if (to === 'INVOICED') {
    return role === 'ADMIN' || role === 'MANAGER' ? null : { status: 403, message: 'Only an admin or manager can confirm an order' }
  }
  if (to === 'CANCELLED') {
    return role === 'ADMIN' ? null : { status: 403, message: 'Only an admin can cancel an order here; a manager requests it through Delete' }
  }
  return { status: 403, message: 'Forbidden' }
}

/** Whether an order of this status counts as a sale in counts/totals/reports. */
export function countsAsSale(status: string): boolean {
  return status !== 'CANCELLED'
}

/**
 * Orders whose lines still need stock from the warehouse (purchase demand). OUT_FOR_DELIVERY / ON_HOLD orders are not
 * demand: their stock already left at assignment.
 */
export const PENDING_DEMAND_STATUSES: readonly OrderStatus[] = ['RECEIVED', 'INVOICED']

/** Badge classes shared by every page that shows an order status. */
export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  RECEIVED: 'bg-slate-100 text-slate-700',
  INVOICED: 'bg-blue-100 text-blue-700',
  OUT_FOR_DELIVERY: 'bg-orange-100 text-orange-700',
  DELIVERED: 'bg-green-100 text-green-700',
  ON_HOLD: 'bg-yellow-100 text-yellow-700',
  RETURNED: 'bg-purple-100 text-purple-700',
  CANCELLED: 'bg-red-100 text-red-700',
}

export function orderStatusColor(s: string): string {
  return isOrderStatus(s) ? ORDER_STATUS_COLOR[s] : ''
}

/** Error for a failed RECEIVED -> INVOICED claim, given the order's locked status (null = row gone). Null when it can proceed. */
export function confirmClaimError(lockedStatus: string | null): { status: number; message: string } | null {
  if (lockedStatus === null) return { status: 404, message: 'Order not found' }
  if (lockedStatus !== 'RECEIVED') return { status: 409, message: `Only a received order can be confirmed (this order is ${lockedStatus})` }
  return null
}
