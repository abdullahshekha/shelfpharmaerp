import { prisma } from '@/lib/prisma'
import { generateChallanNumber } from '@/lib/utils/format'
import type { ChallanData } from '@/components/deliveries/DeliveryChallanPDF'

// Challans are normally created when an order is CONFIRMED; this backfills any confirmed order that predates the feature.
export async function loadChallans(orderIds: string[]): Promise<ChallanData[]> {
  if (orderIds.length === 0) return []

  const missing = await prisma.order.findMany({
    where: { id: { in: orderIds }, challan: null, status: { notIn: ['DRAFT', 'PENDING', 'CANCELLED'] } },
    select: { id: true },
  })
  for (const o of missing) {
    await prisma.deliveryChallan.create({ data: { orderId: o.id, challanNumber: generateChallanNumber() } }).catch(() => {})
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, challan: { isNot: null } },
    include: {
      challan: true,
      invoice: { select: { invoiceNumber: true } },
      delivery: { select: { scheduledDate: true, driver: { select: { name: true } } } },
      retailer: { select: { name: true, phone: true, address: true, area: { select: { name: true } } } },
      items: {
        include: { medicine: { select: { name: true, packSize: true, manufacturer: { select: { name: true } } } } },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { orderNumber: 'asc' },
  })

  return orders.map(o => ({
    challanNumber: o.challan!.challanNumber,
    challanDate: o.challan!.createdAt.toISOString(),
    orderNumber: o.orderNumber,
    invoiceNumber: o.invoice?.invoiceNumber ?? null,
    scheduledDate: o.delivery?.scheduledDate.toISOString() ?? null,
    driverName: o.delivery?.driver?.name ?? null,
    customer: {
      name: o.retailer.name,
      phone: o.retailer.phone,
      address: o.retailer.address,
      area: o.retailer.area?.name ?? null,
    },
    items: o.items.map(i => ({
      id: i.id,
      name: i.medicine.name,
      manufacturer: i.medicine.manufacturer?.name ?? null,
      packSize: i.medicine.packSize,
      quantity: i.quantity,
      bonusQty: i.bonusQty,
    })),
  }))
}
