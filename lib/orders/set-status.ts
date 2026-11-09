import { AccountingError } from '@/lib/accounting/core'
import { confirmClaimError } from '@/lib/orders/status'
import { prisma } from '@/lib/prisma'
import { syncAfterCommit } from '@/lib/deliveries/sync'
import { undeliverInTx } from '@/lib/orders/lifecycle'
import { generateInvoiceNumber, generateChallanNumber, getNextDeliveryDateForArea } from '@/lib/utils/format'

/**
 * Moves an order to `status` with its side effects (invoice/delivery/challan on INVOICED, restock when leaving a
 * stock-out status, ledger sync). Never deducts stock: that happens at assignment (lib/deliveries/assign.ts).
 * Throws AccountingError unchanged.
 */
export async function setOrderStatus(id: string, status: string) {
  const warnings: string[] = []

  let order
  try {
  order = await prisma.$transaction(async (tx) => {
    // Re-setting DELIVERED must be a no-op for stock and deliveredAt. The conditional update also serialises
    // concurrent DELIVERED requests on the row lock: only the one that actually flips the status sees count 1.
    let alreadyDelivered = false
    if (status === 'INVOICED') {
      // Confirm = RECEIVED -> INVOICED only. Lock the row, then claim conditionally so a cancel / portal cart-clear
      // that committed since the caller's check cannot be overwritten (and no invoice is created for it).
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Order" WHERE "id" = ${id} FOR UPDATE`
      const bad = confirmClaimError(locked[0]?.status ?? null)
      if (bad) throw new AccountingError(bad.status, bad.message)
      const claim = await tx.order.updateMany({ where: { id, status: 'RECEIVED' }, data: { status } })
      if (claim.count === 0) throw new AccountingError(409, 'The order changed while confirming, reload and retry')
    } else if (status === 'DELIVERED') {
      const claim = await tx.order.updateMany({ where: { id, status: { not: 'DELIVERED' } }, data: { status } })
      alreadyDelivered = claim.count === 0
    } else {
      // Leaving a stock-out status puts what is still out back (claimed, so concurrent requests restock once).
      const w = await undeliverInTx(tx, id, status)
      if (w !== null) {
        warnings.push(...w)
        // Moving back to an earlier (non-cancelled) status: the delivery is no longer done and no longer assigned
        // (assignedAt cleared so a later assignment dates the new COGS posting itself).
        if (status !== 'CANCELLED') {
          await tx.delivery.updateMany({ where: { orderId: id }, data: { status: 'SCHEDULED', deliveredAt: null, assignedAt: null } })
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

    if (status === 'INVOICED') {
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
      // Stock is no longer deducted here: it leaves at assignment (lib/deliveries/assign.ts), which also records
      // deductedQty/unitCost and dates the COGS posting (Delivery.assignedAt). This only marks the order delivered.
      // Keep a deliveredAt the Deliveries page already recorded.
      await tx.delivery.updateMany({ where: { orderId: id, deliveredAt: null }, data: { deliveredAt: new Date() } })
      await tx.delivery.updateMany({ where: { orderId: id }, data: { status: 'DELIVERED' } })
    }

    return updated
  }, { maxWait: 10000, timeout: 20000 })
  } catch (e) {
    // The order was deleted under us (e.g. a portal cart-clear): not found, not a server error.
    if ((e as { code?: string })?.code === 'P2025') throw new AccountingError(404, 'Order not found')
    throw e
  }

  // Ledger sync after the business transaction has committed (never fails the request).
  const inv = await prisma.invoice.findUnique({ where: { orderId: id }, select: { id: true } }).catch(() => null)
  await syncAfterCommit([['INVOICE', inv?.id], ['DELIVERY_COGS', id]])

  return { order, warnings }
}
