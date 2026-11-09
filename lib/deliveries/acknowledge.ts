// Manager/admin acknowledgement of what a delivery brought back (spec calls 4, 5, 7, 10, 16).
//
//  - acknowledgeCollection: a cash/bank DeliveryCollection becomes a real Payment on that order's invoice (never
//    oldest-first; cheques keep the PDC flow and its own acknowledge action).
//  - acknowledgeReturnedStock: the lines of a delivery-linked Sales Return go back on the shelf (FEFO batch), are
//    flagged restocked, and the order lines' deductedQty drops by what came back; the SALES_RETURN sync then posts the
//    restock entry (Dr Inventory / Cr COGS).
//
// Each runs in ONE interactive transaction. Lock order (same as assign/outcome/payment routes, so no deadlock):
//   Order row (SELECT ... FOR UPDATE) -> PDC_PARTY:<retailerId> advisory lock (collections only) -> batch rows,
//   touched in medicineId order (returned stock only) -> invoice row.
// A double acknowledge is claimed once with a conditional updateMany (count 0 -> 409). Ledger sync runs after commit.
import { prisma } from '@/lib/prisma'
import { restockFefo } from '@/lib/accounting/cost'
import { assertNotLocked, getSettings } from '@/lib/accounting/core'
import { toPaisa } from '@/lib/accounting/money'
import { assertBankAccount } from '@/lib/pdc/create'
import { stillDeductedQty } from './assign-rules'
import { syncAfterCommit } from './sync'
import {
  AckError,
  canAcknowledge,
  collectionAmountError,
  collectionPaymentMethod,
  invoiceStatusFromPaisa,
  planReturnRestock,
  unpaidAfterPaymentsPaisa,
} from './acknowledge-rules'

export { AckError, canAcknowledge } from './acknowledge-rules'

type Actor = { id: string; role: string }

const TX_OPTS = { maxWait: 10000, timeout: 20000 }

function guard(actor: Actor): void {
  if (!actor?.id) throw new AckError(401, 'Not signed in')
  if (!canAcknowledge(actor.role)) throw new AckError(403, 'Only a manager or admin can acknowledge')
}

/** Refuses (409) when `date` would post into a locked period of a live ledger (dates before go-live are not posted). */
function assertPostable(settings: { goLiveDate: Date | null; lockedThrough: Date | null }, date: Date, what: string): void {
  if (!settings.goLiveDate || date < settings.goLiveDate) return
  try {
    assertNotLocked(settings, date)
  } catch {
    throw new AckError(409, `Cannot acknowledge: ${what} falls in a locked accounting period`)
  }
}

const LIST_LIMIT = 500

/** Both acknowledgement lists (oldest first): unacknowledged cash/bank collections and unacknowledged delivery returns. */
export async function listPendingAcknowledgements() {
  const [collections, returns] = await Promise.all([
    prisma.deliveryCollection.findMany({
      where: { acknowledgedAt: null },
      orderBy: { collectedAt: 'asc' },
      take: LIST_LIMIT,
      include: { delivery: { select: { order: { select: { orderNumber: true, retailer: { select: { id: true, name: true } } } } } } },
    }),
    prisma.salesReturn.findMany({
      where: { deliveryId: { not: null }, stockAcknowledgedAt: null },
      orderBy: { returnDate: 'asc' },
      take: LIST_LIMIT,
      include: {
        retailer: { select: { id: true, name: true } },
        items: { select: { id: true, medicineId: true, quantity: true, lineTotal: true, reason: true, medicine: { select: { name: true, code: true } } } },
      },
    }),
  ])

  const orderIds = Array.from(new Set(returns.map((r) => r.orderId).filter((x): x is string => !!x)))
  const deliveryIds = Array.from(new Set(returns.map((r) => r.deliveryId).filter((x): x is string => !!x)))
  const [orders, deliveries] = await Promise.all([
    orderIds.length ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } }) : [],
    deliveryIds.length
      ? prisma.delivery.findMany({ where: { id: { in: deliveryIds } }, select: { id: true, outcome: true, outcomeById: true, outcomeAt: true, outcomePictureUrl: true } })
      : [],
  ])
  const employeeIds = Array.from(new Set([...collections.map((c) => c.collectedById), ...deliveries.map((d) => d.outcomeById)].filter((x): x is string => !!x)))
  const bankIds = Array.from(new Set(collections.map((c) => c.bankAccountId).filter((x): x is string => !!x)))
  const [employees, banks] = await Promise.all([
    employeeIds.length ? prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, name: true } }) : [],
    bankIds.length ? prisma.account.findMany({ where: { id: { in: bankIds } }, select: { id: true, code: true, name: true } }) : [],
  ])
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const deliveryById = new Map(deliveries.map((d) => [d.id, d]))
  // An id with no Employee row is the env-admin login.
  const who = (id: string | null | undefined) => (id ? { id, name: employees.find((e) => e.id === id)?.name ?? 'Admin' } : null)
  const bankById = new Map(banks.map((b) => [b.id, b]))

  return {
    collections: collections.map((c) => ({
      id: c.id,
      deliveryId: c.deliveryId,
      orderId: c.orderId,
      orderNumber: c.delivery.order.orderNumber,
      invoiceId: c.invoiceId,
      customer: c.delivery.order.retailer,
      method: c.method,
      amount: Number(c.amount),
      bankAccount: c.bankAccountId ? (bankById.get(c.bankAccountId) ?? { id: c.bankAccountId, code: '', name: 'Unknown account' }) : null,
      pictureUrl: c.pictureUrl,
      collectedBy: who(c.collectedById),
      collectedAt: c.collectedAt,
    })),
    returns: returns.map((r) => {
      const d = r.deliveryId ? deliveryById.get(r.deliveryId) : undefined
      return {
        id: r.id,
        returnNumber: r.returnNumber,
        returnDate: r.returnDate,
        orderId: r.orderId,
        orderNumber: r.orderId ? (orderById.get(r.orderId)?.orderNumber ?? null) : null,
        deliveryId: r.deliveryId,
        customer: r.retailer,
        totalAmount: Number(r.totalAmount),
        outcome: d?.outcome ?? null,
        pictureUrl: d?.outcomePictureUrl ?? null,
        recordedBy: who(d?.outcomeById),
        recordedAt: d?.outcomeAt ?? r.createdAt,
        items: r.items.map((i) => ({
          id: i.id,
          medicineId: i.medicineId,
          medicineName: i.medicine?.name ?? '',
          medicineCode: i.medicine?.code ?? '',
          quantity: i.quantity,
          lineTotal: Number(i.lineTotal),
          reason: i.reason,
        })),
      }
    }),
  }
}

export async function acknowledgeCollection(collectionId: string, actor: Actor): Promise<{ paymentId: string }> {
  guard(actor)
  const pre = await prisma.deliveryCollection.findUnique({ where: { id: collectionId }, select: { orderId: true, retailerId: true } })
  if (!pre) throw new AckError(404, 'Collection not found')
  const now = new Date()

  const paymentId = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ orderNumber: string }[]>`SELECT "orderNumber" FROM "Order" WHERE "id" = ${pre.orderId} FOR UPDATE`
    if (!locked[0]) throw new AckError(404, 'Order not found')
    // Same per-party lock as the payment routes and cheque clearing: no two of them can over-pay one invoice.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'PDC_PARTY:' + pre.retailerId}))`

    const c = await tx.deliveryCollection.findUnique({ where: { id: collectionId } })
    if (!c) throw new AckError(404, 'Collection not found')
    if (c.acknowledgedAt) throw new AckError(409, 'This collection was already acknowledged')

    const settings = await getSettings(tx)
    assertPostable(settings, now, 'today')

    // Amount due re-checked under the lock: the stored invoice total less payments read now.
    const invoice = await tx.invoice.findUnique({ where: { id: c.invoiceId }, select: { id: true, totalAmount: true, payments: { select: { amount: true } } } })
    if (!invoice) throw new AckError(409, 'The invoice for this collection no longer exists')
    const totalPaisa = toPaisa(Number(invoice.totalAmount))
    const paidPaisa = invoice.payments.map((p) => toPaisa(Number(p.amount)))
    const amountPaisa = toPaisa(Number(c.amount))
    const err = collectionAmountError(amountPaisa, unpaidAfterPaymentsPaisa(totalPaisa, paidPaisa))
    if (err) throw new AckError(409, err)

    const method = collectionPaymentMethod(c.method)
    if (method === 'BANK_TRANSFER') {
      if (!c.bankAccountId) throw new AckError(409, 'This bank collection has no bank account')
      await assertBankAccount(c.bankAccountId, tx) // the ledger posts to it as-is
    }

    const claim = await tx.deliveryCollection.updateMany({
      where: { id: collectionId, acknowledgedAt: null },
      data: { acknowledgedAt: now, acknowledgedById: actor.id },
    })
    if (claim.count === 0) throw new AckError(409, 'This collection was already acknowledged')

    const payment = await tx.payment.create({
      data: {
        retailerId: c.retailerId,
        invoiceId: invoice.id,
        amount: (amountPaisa / 100).toFixed(2),
        method,
        bankAccountId: method === 'BANK_TRANSFER' ? c.bankAccountId : null,
        chequeId: null,
        paymentDate: now,
        reference: locked[0].orderNumber,
        notes: 'Collected at delivery, acknowledged',
      },
      select: { id: true },
    })
    const paidAfter = paidPaisa.reduce((s, p) => s + p, 0) + amountPaisa
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: invoiceStatusFromPaisa(totalPaisa, paidAfter) } })
    await tx.deliveryCollection.update({ where: { id: collectionId }, data: { paymentId: payment.id } })
    return payment.id
  }, TX_OPTS)

  await syncAfterCommit([['PAYMENT', paymentId]])
  return { paymentId }
}

export async function acknowledgeReturnedStock(salesReturnId: string, actor: Actor): Promise<{ warnings: string[] }> {
  guard(actor)
  const pre = await prisma.salesReturn.findUnique({ where: { id: salesReturnId }, select: { orderId: true, deliveryId: true, stockAcknowledgedAt: true } })
  if (!pre) throw new AckError(404, 'Sales return not found')
  if (!pre.deliveryId || !pre.orderId) throw new AckError(409, 'Only returns recorded at delivery need a stock acknowledgement')
  if (pre.stockAcknowledgedAt) throw new AckError(409, 'This returned stock was already acknowledged')
  const orderId = pre.orderId
  const now = new Date()

  const warnings = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`
    const status = locked[0]?.status
    if (!status) throw new AckError(409, 'The order for this return no longer exists')

    const sr = await tx.salesReturn.findUnique({ where: { id: salesReturnId }, select: { returnDate: true, stockAcknowledgedAt: true } })
    if (!sr) throw new AckError(404, 'Sales return not found')
    if (sr.stockAcknowledgedAt) throw new AckError(409, 'This returned stock was already acknowledged')
    // The restock entry is dated on the return date (SALES_RETURN source): refuse rather than leave it unposted.
    const settings = await getSettings(tx)
    assertPostable(settings, sr.returnDate, 'the return date')

    const claim = await tx.salesReturn.updateMany({
      where: { id: salesReturnId, stockAcknowledgedAt: null },
      data: { stockAcknowledgedAt: now, stockAcknowledgedById: actor.id },
    })
    if (claim.count === 0) throw new AckError(409, 'This returned stock was already acknowledged')

    const returnItems = await tx.salesReturnItem.findMany({
      where: { salesReturnId, restocked: false },
      select: { id: true, medicineId: true, quantity: true, medicine: { select: { name: true } } },
    })
    const orderItems = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, medicineId: true, quantity: true, deductedQty: true } })
    const plan = planReturnRestock(
      orderItems.map((i) => ({ id: i.id, medicineId: i.medicineId, out: stillDeductedQty(status, i) })),
      returnItems.map((i) => ({ id: i.id, medicineId: i.medicineId, quantity: i.quantity })),
    )
    const names = new Map(returnItems.map((i) => [i.id, i.medicine?.name ?? i.medicineId]))

    const out: string[] = []
    // Batch rows touched in medicineId order (same as assignment), so this cannot deadlock with an assign.
    const ordered = [...plan.items].sort((a, b) => (a.medicineId < b.medicineId ? -1 : a.medicineId > b.medicineId ? 1 : a.id < b.id ? -1 : 1))
    for (const p of ordered) {
      const name = names.get(p.id)
      if (p.restockQty === 0) {
        // Nothing of it is recorded as out of the warehouse (e.g. an order converted from DISPATCHED that never
        // deducted stock): there is nothing to put back and no cost to reverse. Acknowledged, not restocked.
        out.push(`${name}: ${p.excess} unit(s) were not recorded as taken out of stock, nothing restocked`)
        continue
      }
      if (p.excess > 0) {
        // The restock ledger entry costs the whole return line; a partial restock would overstate it.
        throw new AckError(409, `${name}: ${p.excess} returned unit(s) are more than this order took out of stock; correct the return first`)
      }
      const r = await restockFefo(tx, p.medicineId, p.restockQty)
      if (!r.batchId) throw new AckError(409, `${name}: ${r.warning ?? 'no stock batch to restock onto'}`)
      await tx.salesReturnItem.update({ where: { id: p.id }, data: { restocked: true, batchId: r.batchId } })
    }
    for (const [lineId, deductedQty] of Array.from(plan.newDeducted)) {
      await tx.orderItem.update({ where: { id: lineId }, data: { deductedQty } })
    }
    return out
  }, TX_OPTS)

  await syncAfterCommit([['SALES_RETURN', salesReturnId]])
  return { warnings }
}
