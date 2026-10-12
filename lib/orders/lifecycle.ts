// Order cancel / hard delete / un-deliver, shared by the order routes and the delete-approval executor.
//
// Stock rule: a DELIVERED order has had its lines deducted FEFO (OrderItem.deductedQty records how many units
// actually came off the shelf; null on legacy rows = quantity). Whenever an order leaves DELIVERED those units are
// put back (restockFefo, earliest-expiring batch) and unitCost/deductedQty are cleared, so the DELIVERY_COGS
// entry disappears on the next sync and the Inventory ledger matches physical stock again.
// Restock happens ONLY on the DELIVERED -> something transition, claimed with a conditional
// `updateMany where status = DELIVERED`: concurrent requests serialise on the row lock and only one sees count 1.
import { prisma } from '@/lib/prisma'
import { restockFefo, restockQtyFor } from '@/lib/accounting/cost'
import { syncAllSafe } from '@/lib/accounting/sync'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

const TX_OPTS = { maxWait: 10000, timeout: 20000 }

/** Restocks every line of a (just un-delivered) order and clears unitCost/deductedQty. Returns warnings. */
export async function restockOrderItems(tx: Tx, orderId: string): Promise<string[]> {
  const items = await tx.orderItem.findMany({ where: { orderId }, include: { medicine: { select: { name: true } } } })
  const warnings: string[] = []
  for (const item of items) {
    const qty = restockQtyFor(item)
    if (qty > 0) {
      const { warning } = await restockFefo(tx, item.medicineId, qty)
      if (warning) warnings.push(`${item.medicine?.name ?? item.medicineId}: ${warning}`)
    }
  }
  await tx.orderItem.updateMany({ where: { orderId }, data: { unitCost: null, deductedQty: null } })
  return warnings
}

/**
 * Claims the DELIVERED -> `status` transition and restocks if this call won it. Returns null when the order
 * was not DELIVERED (nothing restocked), else the warnings.
 */
export async function undeliverInTx(tx: Tx, orderId: string, status: string): Promise<string[] | null> {
  const claim = await tx.order.updateMany({ where: { id: orderId, status: 'DELIVERED' }, data: { status } })
  if (claim.count === 0) return null
  return restockOrderItems(tx, orderId)
}

/** Soft cancel (status CANCELLED). Restocks first if the order was DELIVERED. The Delivery row is left as is. */
export async function cancelOrder(orderId: string): Promise<{ warnings: string[] }> {
  const warnings = await prisma.$transaction(async (tx) => {
    const w = await undeliverInTx(tx, orderId, 'CANCELLED')
    if (w === null) await tx.order.updateMany({ where: { id: orderId }, data: { status: 'CANCELLED' } })
    return w ?? []
  }, TX_OPTS)
  const inv = await prisma.invoice.findUnique({ where: { orderId }, select: { id: true } }).catch(() => null)
  await syncAllSafe([['INVOICE', inv?.id], ['DELIVERY_COGS', orderId]])
  return { warnings }
}

/**
 * Hard delete: order, items, delivery, challan, invoice and its payments. A DELIVERED order is restocked inside the
 * same transaction; any other status (including an already CANCELLED one, restocked at cancel time) is not.
 */
export async function hardDeleteOrder(orderId: string): Promise<{ warnings: string[] }> {
  // Capture ids before the cascade-delete so their ledger entries can be removed afterwards.
  const doomedInvoice = await prisma.invoice.findUnique({ where: { orderId }, select: { id: true } })
  const doomedPayments = doomedInvoice
    ? await prisma.payment.findMany({ where: { invoiceId: doomedInvoice.id }, select: { id: true } })
    : []

  const warnings = await prisma.$transaction(async (tx) => {
    const w = (await undeliverInTx(tx, orderId, 'CANCELLED')) ?? []
    await tx.delivery.deleteMany({ where: { orderId } })
    await tx.deliveryChallan.deleteMany({ where: { orderId } })
    const invoice = await tx.invoice.findUnique({ where: { orderId } })
    if (invoice) {
      await tx.payment.deleteMany({ where: { invoiceId: invoice.id } })
      await tx.invoice.delete({ where: { id: invoice.id } })
    }
    // deleteMany: a concurrent delete that already removed the order is not an error. Items cascade.
    await tx.order.deleteMany({ where: { id: orderId } })
    return w
  }, TX_OPTS)

  await syncAllSafe([
    ['INVOICE', doomedInvoice?.id],
    ['DELIVERY_COGS', orderId],
    ...doomedPayments.map((p): ['PAYMENT', string] => ['PAYMENT', p.id]),
  ])
  return { warnings }
}
