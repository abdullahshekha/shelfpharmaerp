import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateOrderNumber } from '@/lib/utils/format'
import type { PricedLine } from '@/lib/portal/pricing'

export interface PortalOrderView {
  id: string
  orderNumber: string
  orderDate: string
  status: string
  totalAmount: number          // product subtotal, excludes sales tax
  invoiceTotal: number | null  // tax-inclusive, once staff have confirmed and an invoice exists
  scheduledDate: string | null
  items: { medicineId: string; code: string; name: string; quantity: number; unitPrice: number; offerPercent: number; lineTotal: number }[]
}

export const orderViewInclude = {
  items: { include: { medicine: { select: { code: true, name: true } } }, orderBy: { id: 'asc' as const } },
  invoice: { select: { totalAmount: true } },
  delivery: { select: { scheduledDate: true } },
} satisfies Prisma.OrderInclude

type OrderWithView = Prisma.OrderGetPayload<{ include: typeof orderViewInclude }>

/** Explicit whitelist — the browser never receives the raw Order row. */
export function serializeOrder(o: OrderWithView): PortalOrderView {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    orderDate: o.orderDate.toISOString(),
    status: o.status,
    totalAmount: Number(o.totalAmount),
    invoiceTotal: o.invoice ? Number(o.invoice.totalAmount) : null,
    scheduledDate: o.delivery ? o.delivery.scheduledDate.toISOString() : null,
    items: o.items.map(i => ({
      medicineId: i.medicineId,
      code: i.medicine.code,
      name: i.medicine.name,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      offerPercent: Number(i.offerPercent),
      lineTotal: Number(i.lineTotal),
    })),
  }
}

export async function findOpenOrder(retailerId: string): Promise<PortalOrderView | null> {
  const o = await prisma.order.findFirst({
    where: { retailerId, status: 'PENDING', source: 'OFFER_LIST', invoice: { is: null } },
    orderBy: { createdAt: 'desc' },
    include: orderViewInclude,
  })
  return o ? serializeOrder(o) : null
}

export class PortalConflict extends Error {}

export const CONFIRMED_MESSAGE = 'Your order was updated by our team — your changes were not saved'
export const ALREADY_OPEN_MESSAGE = 'You already have an open order — it has been reloaded'

/**
 * Create / replace / delete the customer's open order in one transaction.
 *  - orderId set  → must be the customer's current open PENDING portal order, else PortalConflict.
 *  - orderId null → must have no open order (a second tab/device would otherwise overwrite), else PortalConflict.
 *  - empty `lines` with an orderId → the (portal-created, PENDING) order is deleted; returns null.
 * The caller has already validated the cart and priced every line server-side.
 */
export async function savePortalOrder(params: {
  retailerId: string
  salesRepId: string | null
  orderId: string | null
  lines: PricedLine[]
  total: number
}): Promise<PortalOrderView | null> {
  const { retailerId, salesRepId, orderId, lines, total } = params
  const lineData = lines.map(l => ({
    medicineId: l.medicineId, quantity: l.quantity, mrp: l.mrp, unitPrice: l.unitPrice, offerPercent: l.offerPercent,
    salesTax: l.salesTax, salesTaxAmount: l.salesTaxAmount, lineTotal: l.lineTotal,
  }))

  // orderNumber is "SP-YYYYMMDD-<random 4 digits>"; retry on the (unlikely) unique collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        // Serialise all portal saves for this customer (transaction-scoped; safe under pgbouncer)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${retailerId}))`
        const open = await tx.order.findFirst({
          where: { retailerId, status: 'PENDING', source: 'OFFER_LIST', invoice: { is: null } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })

        if (orderId) {
          if (!open || open.id !== orderId) throw new PortalConflict(CONFIRMED_MESSAGE)
        } else if (open) {
          throw new PortalConflict(ALREADY_OPEN_MESSAGE)
        }

        if (lines.length === 0) {
          // orderId is guaranteed set here (the route rejects an empty cart without one)
          // The status condition is part of the write itself, so a concurrent staff CONFIRM loses/wins atomically
          const n = await tx.order.deleteMany({ where: { id: orderId!, retailerId, status: 'PENDING', source: 'OFFER_LIST', invoice: { is: null } } }) // items cascade
          if (n.count !== 1) throw new PortalConflict(CONFIRMED_MESSAGE)
          return null
        }

        let id: string
        if (orderId) {
          const n = await tx.order.updateMany({ where: { id: orderId, retailerId, status: 'PENDING', source: 'OFFER_LIST', invoice: { is: null } }, data: { totalAmount: total } })
          if (n.count !== 1) throw new PortalConflict(CONFIRMED_MESSAGE)
          await tx.orderItem.deleteMany({ where: { orderId } })
          await tx.orderItem.createMany({ data: lineData.map(l => ({ ...l, orderId })) })
          id = orderId
        } else {
          const created = await tx.order.create({
            data: {
              orderNumber: generateOrderNumber(),
              retailerId,
              salesRepId,
              source: 'OFFER_LIST',
              totalAmount: total,
              items: { create: lineData },
            },
            select: { id: true },
          })
          id = created.id
        }
        const saved = await tx.order.findUniqueOrThrow({ where: { id }, include: orderViewInclude })
        return serializeOrder(saved)
      }, { maxWait: 10000, timeout: 15000 })
    } catch (e) {
      const isNumberCollision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && !orderId
      if (isNumberCollision && attempt < 2) continue
      throw e
    }
  }
  throw new Error('unreachable')
}
