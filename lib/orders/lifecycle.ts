// Order cancel / hard delete / un-deliver / un-assign restock, shared by the order routes, the delete-approval
// executor and lib/deliveries/assign.ts.
//
// Stock rule: stock leaves the warehouse when a delivery is assigned (lib/deliveries/assign.ts), so an order whose
// status is in STOCK_OUT_STATUSES (OUT_FOR_DELIVERY, ON_HOLD, DELIVERED, RETURNED) has units out. OrderItem.deductedQty
// is the single source of truth for how many are still out (a returned-stock acknowledgement reduces it; a null on a
// legacy DELIVERED row = the ordered quantity, a null anywhere else = nothing deducted, see stillDeductedQty).
// Whenever an order leaves the stock-out statuses for a non-stock-out one (cancel, delete, un-deliver, un-assign)
// what is still out is put back (restockFefo, earliest-expiring batch) and unitCost/deductedQty are cleared, so the
// DELIVERY_COGS entry disappears on the next sync and the Inventory ledger matches physical stock again.
// If the order's DELIVERY_COGS entry is in a locked period the transition is refused (AccountingError 409) and
// nothing changes. The transition is claimed with a conditional `updateMany where status = <stock-out status>` on the
// locked order row: concurrent requests serialise and only one restocks.
import { prisma } from '@/lib/prisma'
import { restockFefo } from '@/lib/accounting/cost'
import { AccountingError, assertNotLocked, getSettings } from '@/lib/accounting/core'
import { clearedChequeDeleteBlock } from '@/lib/pdc/rules'
import { STOCK_OUT_STATUSES } from '@/lib/orders/status'
import { stillDeductedQty } from '@/lib/deliveries/assign-rules'
import { syncAfterCommit } from '@/lib/deliveries/sync'
import { acknowledgedCollectionDeleteBlock, orderReturnBlock } from '@/lib/deliveries/acknowledge-rules'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

const TX_OPTS = { maxWait: 10000, timeout: 20000 }

export const isStockOutStatus = (s: string) => (STOCK_OUT_STATUSES as readonly string[]).includes(s)

/**
 * Restocks what is still deducted on every line of an order that was in `fromStatus` (see stillDeductedQty) and
 * clears unitCost/deductedQty. Returns warnings.
 */
export async function restockOrderItems(tx: Tx, orderId: string, fromStatus: string): Promise<string[]> {
  const found = await tx.orderItem.findMany({ where: { orderId }, include: { medicine: { select: { name: true } } } })
  // Sorted by medicineId (same order as assignment locks batches) so a cancel and an assign cannot deadlock.
  const items = [...found].sort((a, b) => (a.medicineId < b.medicineId ? -1 : a.medicineId > b.medicineId ? 1 : 0))
  const warnings: string[] = []
  for (const item of items) {
    const qty = stillDeductedQty(fromStatus, item)
    if (qty > 0) {
      const { warning } = await restockFefo(tx, item.medicineId, qty)
      if (warning) warnings.push(`${item.medicine?.name ?? item.medicineId}: ${warning}`)
    }
  }
  await tx.orderItem.updateMany({ where: { orderId }, data: { unitCost: null, deductedQty: null } })
  return warnings
}

/**
 * Refuses (AccountingError 409) when the order's DELIVERY_COGS entry is in a locked period: stock would come back
 * while the ledger keeps the cost, because sync skips sources whose existing entries are locked.
 */
export async function assertCogsRemovable(tx: Tx, orderId: string): Promise<void> {
  const settings = await getSettings(tx)
  if (!settings.goLiveDate) return
  const cogs = await tx.journalEntry.findMany({ where: { sourceType: 'DELIVERY_COGS', sourceId: orderId, isManual: false }, select: { date: true } })
  for (const e of cogs) {
    try {
      assertNotLocked(settings, e.date)
    } catch {
      throw new AccountingError(409, COGS_LOCKED_MESSAGE)
    }
  }
}

/**
 * Moves an order out of a stock-out status into `status` (a non-stock-out status: CANCELLED, INVOICED, or an old
 * pre-rework status) and restocks if this call won the transition. Returns null when nothing was claimed (the order
 * is not in a stock-out status, or `status` is itself a stock-out status), else the restock warnings.
 */
export async function undeliverInTx(tx: Tx, orderId: string, status: string): Promise<string[] | null> {
  if (isStockOutStatus(status)) return null
  // Lock the row so the status read here is the one the claim below sees (a concurrent assign/cancel waits).
  const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`
  const from = locked[0]?.status
  if (!from) return null
  // Under the row lock: an order with a delivery-linked return is never cancelled / un-delivered / deleted.
  await assertNoDeliveryReturn(tx, orderId)
  if (!isStockOutStatus(from)) return null
  const claim = await tx.order.updateMany({ where: { id: orderId, status: from }, data: { status } })
  if (claim.count === 0) return null
  // Throwing rolls the claim back: nothing changes.
  await assertCogsRemovable(tx, orderId)
  return restockOrderItems(tx, orderId, from)
}

/**
 * Refuses (AccountingError 409, so a MANAGER approval stays PENDING) when the order has any delivery-linked sales
 * return, acknowledged or not: unacknowledged returned stock would be restocked twice (here and at acknowledgement),
 * and an acknowledged one would leave its restock ledger entry orphaned. Call with the Order row locked.
 */
export async function assertNoDeliveryReturn(tx: Tx, orderId: string): Promise<void> {
  const n = await tx.salesReturn.count({ where: { orderId } })
  const block = orderReturnBlock(n)
  if (block) throw new AccountingError(409, block)
}

/** Spec call 9: refuses (AccountingError 409) once a delivery collection on this order became a Payment. */
async function assertNoAcknowledgedCollection(db: Tx | typeof prisma, orderId: string): Promise<void> {
  const cols = await db.deliveryCollection.findMany({ where: { orderId }, select: { acknowledgedAt: true } })
  const block = acknowledgedCollectionDeleteBlock(cols)
  if (block) throw new AccountingError(409, block)
}

export const COGS_LOCKED_MESSAGE = 'Cannot cancel or un-deliver: the delivery cost was posted in a locked accounting period'

/** Soft cancel (status CANCELLED). Restocks what is still out first if the order's stock had left. The Delivery row is left as is. */
export async function cancelOrder(orderId: string): Promise<{ warnings: string[] }> {
  const warnings = await prisma.$transaction(async (tx) => {
    const w = await undeliverInTx(tx, orderId, 'CANCELLED')
    if (w === null) await tx.order.updateMany({ where: { id: orderId }, data: { status: 'CANCELLED' } })
    return w ?? []
  }, TX_OPTS)
  const inv = await prisma.invoice.findUnique({ where: { orderId }, select: { id: true } }).catch(() => null)
  await syncAfterCommit([['INVOICE', inv?.id], ['DELIVERY_COGS', orderId]])
  return { warnings }
}

/** Refuses (AccountingError 409, so a MANAGER approval stays PENDING) when a cleared cheque paid this invoice. */
async function assertNoChequePayments(db: Tx | typeof prisma, invoiceId: string): Promise<void> {
  const pays = await db.payment.findMany({
    where: { invoiceId, chequeId: { not: null } },
    select: { chequeId: true, cheque: { select: { chequeNumber: true } } },
  })
  const block = clearedChequeDeleteBlock(pays.map((p) => ({ chequeId: p.chequeId, chequeNumber: p.cheque?.chequeNumber })))
  if (block) throw new AccountingError(409, block)
}

/**
 * Hard delete: order, items, unacknowledged delivery collections, delivery, challan, invoice and its payments. Refused
 * when a collection on the order was acknowledged (it is a Payment now), when the order has a delivery-linked sales
 * return, or when any of those payments came from a cleared cheque (deleting it would silently drop bank money while the cheque stays CLEARED). An order in a stock-out
 * status has what is still out restocked inside the same transaction; any other status (including an already
 * CANCELLED one, restocked at cancel time) is not.
 */
export async function hardDeleteOrder(orderId: string): Promise<{ warnings: string[] }> {
  // Capture ids before the cascade-delete so their ledger entries can be removed afterwards.
  const doomedInvoice = await prisma.invoice.findUnique({ where: { orderId }, select: { id: true } })
  const doomedPayments = doomedInvoice
    ? await prisma.payment.findMany({ where: { invoiceId: doomedInvoice.id }, select: { id: true } })
    : []
  if (doomedInvoice) await assertNoChequePayments(prisma, doomedInvoice.id)
  await assertNoAcknowledgedCollection(prisma, orderId)

  const warnings = await prisma.$transaction(async (tx) => {
    // Lock the order row first (same order as assign/outcome/acknowledge), then re-check inside the transaction:
    // a cheque may have cleared, or a collection been acknowledged, against this invoice meanwhile.
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`
    const inv = await tx.invoice.findUnique({ where: { orderId }, select: { id: true } })
    if (inv) await assertNoChequePayments(tx, inv.id)
    await assertNoAcknowledgedCollection(tx, orderId)
    // undeliverInTx also refuses an order with a delivery-linked return (assertNoDeliveryReturn).
    const w = (await undeliverInTx(tx, orderId, 'CANCELLED')) ?? []
    // Unacknowledged collections go with the order (they reference the Delivery, so before it).
    await tx.deliveryCollection.deleteMany({ where: { orderId } })
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

  await syncAfterCommit([
    ['INVOICE', doomedInvoice?.id],
    ['DELIVERY_COGS', orderId],
    ...doomedPayments.map((p): ['PAYMENT', string] => ['PAYMENT', p.id]),
  ])
  return { warnings }
}
