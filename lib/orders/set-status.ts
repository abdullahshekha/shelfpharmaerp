import { AccountingError } from '@/lib/accounting/core'
import { prisma } from '@/lib/prisma'
import { deductFefo, unitCostFrom } from '@/lib/accounting/cost'
import { totalUnits } from '@/lib/orders/units'
import { syncAllSafe } from '@/lib/accounting/sync'
import { undeliverInTx } from '@/lib/orders/lifecycle'
import { generateInvoiceNumber, generateChallanNumber, getNextDeliveryDateForArea } from '@/lib/utils/format'

/** Moves an order to `status` with all side effects (stock, invoice/delivery/challan, ledger sync). Throws AccountingError unchanged. */
export async function setOrderStatus(id: string, status: string) {
  const warnings: string[] = []

  // A draft is not a real order yet: it can only be confirmed into PENDING (or cancelled).
  const current = await prisma.order.findUnique({ where: { id }, select: { status: true } })
  if (current?.status === 'DRAFT' && status !== 'PENDING' && status !== 'CANCELLED') {
    throw new AccountingError(409, 'A draft must be confirmed (set to PENDING) before it can move on')
  }

  const order = await prisma.$transaction(async (tx) => {
    // Re-setting DELIVERED must be a no-op for stock and deliveredAt. The conditional update also serialises
    // concurrent DELIVERED requests on the row lock: only the one that actually flips the status sees count 1.
    let alreadyDelivered = false
    if (status === 'DELIVERED') {
      const claim = await tx.order.updateMany({ where: { id, status: { not: 'DELIVERED' } }, data: { status } })
      alreadyDelivered = claim.count === 0
    } else {
      // Leaving DELIVERED puts the deducted stock back (claimed, so concurrent requests restock once).
      const w = await undeliverInTx(tx, id, status)
      if (w !== null) {
        warnings.push(...w)
        // Moving back to an earlier (non-cancelled) status: the delivery is no longer done.
        if (status !== 'CANCELLED') {
          await tx.delivery.updateMany({ where: { orderId: id }, data: { status: 'SCHEDULED', deliveredAt: null } })
        }
      }
    }

    const updated = await tx.order.update({
      where: { id },
      data: { status },
      include: {
        items: { include: { medicine: true } },
        retailer: { include: { area: { select: { deliveryDays: true } } } },
      },
    })

    if (status === 'CONFIRMED') {
      const existing = await tx.invoice.findUnique({ where: { orderId: id } })
      if (!existing) {
        const subtotal = Number(updated.totalAmount)
        const discount = Number(updated.discountAmount)
        const taxAmount = updated.items.reduce((sum, i) => sum + Number(i.salesTaxAmount), 0)
        const total = subtotal - discount + taxAmount

        const dueDate = new Date()
        dueDate.setDate(dueDate.getDate() + (updated.retailer.creditDays ?? 0))

        await tx.invoice.create({
          data: {
            invoiceNumber: generateInvoiceNumber(),
            orderId: id,
            retailerId: updated.retailerId,
            subtotal,
            discountAmount: discount,
            taxAmount,
            totalAmount: total,
            dueDate,
          },
        })
      }

      const existingDelivery = await tx.delivery.findUnique({ where: { orderId: id } })
      if (!existingDelivery) {
        await tx.delivery.create({
          data: {
            orderId: id,
            scheduledDate: getNextDeliveryDateForArea(updated.retailer.area?.deliveryDays),
          },
        })
      }

      const existingChallan = await tx.deliveryChallan.findUnique({ where: { orderId: id } })
      if (!existingChallan) {
        await tx.deliveryChallan.create({ data: { orderId: id, challanNumber: generateChallanNumber() } })
      }
    }

    if (status === 'DELIVERED' && !alreadyDelivered) {
      for (const item of updated.items) {
        const { costSum, deducted } = await deductFefo(tx, item.medicineId, totalUnits(item))
        // Bonus units come off the shelf too; unitCost stays per ORDERED unit so quantity x unitCost (the COGS posting)
        // covers the cost of the free units as well.
        // deductedQty records what actually came off the shelf (0 on a full shortfall) so an un-deliver/cancel
        // restocks exactly that.
        await tx.orderItem.update({
          where: { id: item.id },
          data: { deductedQty: deducted, ...(deducted > 0 ? { unitCost: unitCostFrom(costSum, item.quantity) } : {}) },
        })
      }

      // Keep a deliveredAt the Deliveries page already recorded (it dates the COGS posting).
      await tx.delivery.updateMany({ where: { orderId: id, deliveredAt: null }, data: { deliveredAt: new Date() } })
      await tx.delivery.updateMany({ where: { orderId: id }, data: { status: 'DELIVERED' } })
    }

    return updated
  }, { maxWait: 10000, timeout: 20000 })

  // Ledger sync after the business transaction has committed (never fails the request).
  const inv = await prisma.invoice.findUnique({ where: { orderId: id }, select: { id: true } }).catch(() => null)
  await syncAllSafe([['INVOICE', inv?.id], ['DELIVERY_COGS', id]])

  return { order, warnings }
}
