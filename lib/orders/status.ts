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
 * INVOICED -> READY, OUT_FOR_DELIVERY -> ASSIGNED, DELIVERED, RETURNED.
 * ON_HOLD shows only on its scheduled (held-until) day or later, compared as Karachi calendar days.
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
      return karachiDayKey(delivery.scheduledDate) <= karachiDayKey(now) ? 'ON_HOLD' : null
    default: return null
  }
}
