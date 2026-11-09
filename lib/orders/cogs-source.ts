// Pure DELIVERY_COGS source rule (no Prisma imports), shared by sync.ts load() and the rebuild-chunk query.
//
// An order's cost of goods sold is posted while its stock is out of the warehouse (status in STOCK_OUT_STATUSES),
// dated when the stock left: Delivery.assignedAt. Legacy orders delivered before assignment existed have no
// assignedAt and keep their old date: deliveredAt, then invoice date, then order date (never updatedAt).
import { STOCK_OUT_STATUSES } from '@/lib/orders/status'

export type CogsSourceInput = {
  status: string
  assignedAt: Date | null | undefined
  deliveredAt: Date | null | undefined
  invoiceDate: Date | null | undefined
  orderDate: Date
}

export function cogsSourceFor(o: CogsSourceInput): { eligible: boolean; date: Date } {
  return {
    eligible: (STOCK_OUT_STATUSES as readonly string[]).includes(o.status),
    date: o.assignedAt ?? o.deliveredAt ?? o.invoiceDate ?? o.orderDate,
  }
}

/**
 * Prisma `Order` where-clause selecting the orders cogsSourceFor() makes eligible with a date on/after `from`.
 * Each branch of the OR is one step of the date fallback chain, so it must stay in step with cogsSourceFor().
 */
export function cogsQualifyingWhere(from: Date) {
  const noDelivery = { delivery: { is: null } }
  const noAssigned = { OR: [noDelivery, { delivery: { is: { assignedAt: null } } }] }
  const noAssignedOrDelivered = { OR: [noDelivery, { delivery: { is: { assignedAt: null, deliveredAt: null } } }] }
  return {
    status: { in: [...STOCK_OUT_STATUSES] },
    OR: [
      { delivery: { is: { assignedAt: { gte: from } } } },
      { AND: [noAssigned, { delivery: { is: { deliveredAt: { gte: from } } } }] },
      {
        AND: [
          noAssignedOrDelivered,
          { OR: [{ invoice: { is: { invoiceDate: { gte: from } } } }, { AND: [{ invoice: { is: null } }, { orderDate: { gte: from } }] }] },
        ],
      },
    ],
  }
}
