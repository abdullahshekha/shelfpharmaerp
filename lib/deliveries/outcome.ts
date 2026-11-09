// Recording a delivery outcome: the only way an OUT_FOR_DELIVERY order becomes DELIVERED, RETURNED or ON_HOLD.
//
// Everything happens in ONE interactive transaction on the locked Order row:
//   lock order -> check who (canRecordOutcome, read under the lock so a concurrent re-assign is seen) -> validate the
//   input (validateOutcomeInput; the amount to collect is computed here, never taken from the client) -> claim
//   OUT_FOR_DELIVERY -> <target> with a conditional updateMany (a double tap records once: the second request waits on
//   the row lock, then finds the order already moved and gets 409) -> the outcome's records.
//
// Money never becomes a Payment here (spec calls 4/12): cash/bank is a DeliveryCollection waiting for a manager/admin
// acknowledgement; a cheque is an unacknowledged Pending PDC cheque. Returned lines become a Sales Return (credits AR
// through the existing SALES_RETURN posting) whose lines are NOT restocked: the stock comes back only when a
// manager/admin acknowledges the returned goods (Task 5). The ledger is synced after commit (syncAfterCommit).
import { prisma } from '@/lib/prisma'
import { assertNotLocked, getSettings } from '@/lib/accounting/core'
import { fromPaisa, toPaisa } from '@/lib/accounting/money'
import { parseDateInput } from '@/lib/accounting/dates'
import { assertBankAccount, createChequeRecord, parseChequeAmount } from '@/lib/pdc/create'
import { generateSalesReturnNumber } from '@/lib/utils/format'
import { hasCurrentOutcome } from './assign-rules'
import { syncAfterCommit } from './sync'
import { isDeliveryPictureUrl } from './picture'
import {
  OutcomeError,
  amountDueFromStored,
  buildSalesReturnLines,
  canRecordOutcome,
  chequeAmountMismatch,
  hasUndeductedLines,
  UNDEDUCTED_OUTCOME_MESSAGE,
  outcomeBodyError,
  outcomeOrderStatus,
  validateOutcomeInput,
  type Outcome,
  type OutcomeInput,
  type ReturnSourceItem,
} from './outcome-rules'

export { OutcomeError, canRecordOutcome, buildSalesReturnLines } from './outcome-rules'

type Actor = { id: string; role: string }
export type RecordOutcomeInput = OutcomeInput & { allowDuplicate?: boolean }
export type RecordOutcomeResult = { outcome: Outcome; collectionId?: string; chequeId?: string; salesReturnId?: string }

const TX_OPTS = { maxWait: 10000, timeout: 20000 }
const PAYMENT_OUTCOMES: readonly Outcome[] = ['PAID_FULL', 'PAID_WITH_RETURN']

function toDateInput(v: string | Date | undefined): string | undefined {
  if (v instanceof Date) return v.toISOString()
  return v
}

/**
 * Request checks that need no database: body shape, the picture is one our upload route stored, and a door cheque's
 * entered amount is a valid positive amount (returned in paisa; compared with the amount due in the transaction).
 */
function precheck(input: unknown): { chequePaisa: number | null } {
  const shape = outcomeBodyError(input)
  if (shape) throw new OutcomeError(400, shape)
  const i = input as RecordOutcomeInput
  const pic = i.pictureUrl?.trim()
  if (pic && !isDeliveryPictureUrl(pic, process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new OutcomeError(400, 'The picture must be uploaded through the delivery picture upload')
  }
  let chequePaisa: number | null = null
  if (PAYMENT_OUTCOMES.includes(i.outcome as Outcome) && i.method === 'CHEQUE') {
    if (i.chequeAmount === undefined || i.chequeAmount === null || i.chequeAmount === '') throw new OutcomeError(400, 'Cheque amount is required')
    chequePaisa = toPaisa(parseChequeAmount(i.chequeAmount)) // ChequeError 400 when not a positive 2-decimal amount
  }
  return { chequePaisa }
}

export async function recordOutcome(deliveryId: string, actor: Actor, input: RecordOutcomeInput): Promise<RecordOutcomeResult> {
  if (!actor?.id) throw new OutcomeError(401, 'Not signed in')
  const { chequePaisa } = precheck(input)
  const now = new Date()

  const { out: result, orderId } = await prisma.$transaction(async (tx) => {
    const found = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { orderId: true } })
    if (!found) throw new OutcomeError(404, 'Delivery not found')

    // Same lock assign/unassign/reassign take: every move of this delivery is serialised on the Order row.
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Order" WHERE "id" = ${found.orderId} FOR UPDATE`
    const status = locked[0]?.status
    if (!status) throw new OutcomeError(404, 'Order not found')

    const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { id: true, driverId: true, outcome: true } })
    if (!delivery) throw new OutcomeError(404, 'Delivery not found')
    if (!canRecordOutcome(actor, delivery)) throw new OutcomeError(403, 'Only the assigned person or a manager/admin can record this delivery')
    if (status !== 'OUT_FOR_DELIVERY' || hasCurrentOutcome(delivery.outcome)) {
      throw new OutcomeError(409, `An outcome can only be recorded for a delivery that is out for delivery (this order is ${status})`)
    }

    const order = await tx.order.findUnique({
      where: { id: found.orderId },
      include: {
        items: { orderBy: { id: 'asc' } },
        invoice: { include: { payments: { select: { amount: true } } } },
      },
    })
    if (!order) throw new OutcomeError(404, 'Order not found')
    if (!order.invoice) throw new OutcomeError(409, 'This order has no invoice')
    // Read under the order lock: a line whose stock never left (null deductedQty, e.g. a converted DISPATCHED order)
    // must go through un-assign -> assign first so stock leaves and COGS posts.
    if (hasUndeductedLines(order.items)) throw new OutcomeError(409, UNDEDUCTED_OUTCOME_MESSAGE)
    const invoice = order.invoice

    const items: ReturnSourceItem[] = order.items.map((i) => ({
      id: i.id,
      medicineId: i.medicineId,
      quantity: i.quantity,
      bonusQty: i.bonusQty,
      deductedQty: i.deductedQty,
      lineTotal: Number(i.lineTotal),
      salesTaxAmount: Number(i.salesTaxAmount),
    }))
    const outcomeOrder = { items, discountAmount: Number(order.discountAmount) }

    const v = validateOutcomeInput(input, outcomeOrder, now)
    if (!v.ok) throw new OutcomeError(400, v.error)
    const outcome = input.outcome as Outcome

    // Returned lines -> Sales Return (credit computed exactly as the invoice was built). A whole-order return credits
    // exactly the STORED invoice total; no return can credit more than the invoice total less earlier credits against
    // this order.
    const invoiceTotalPaisa = toPaisa(Number(invoice.totalAmount))
    const earlier = await tx.salesReturn.findMany({ where: { orderId: order.id }, select: { totalAmount: true } })
    const earlierCredits = earlier.reduce((s, r) => s + toPaisa(Number(r.totalAmount)), 0)
    const returnOpts = { invoiceTotalPaisa, capPaisa: Math.max(0, invoiceTotalPaisa - earlierCredits) }
    const returned =
      outcome === 'PAID_WITH_RETURN'
        ? buildSalesReturnLines(outcomeOrder, v.returnedLines, returnOpts)
        : outcome === 'RETURNED'
          ? buildSalesReturnLines(outcomeOrder, items.map((i) => ({ orderItemId: i.id, quantity: i.quantity, reason: input.reason })), returnOpts)
          : null

    // Amount to collect: the STORED invoice total, less payments already on it and the return credit.
    let duePaisa = 0
    if (PAYMENT_OUTCOMES.includes(outcome)) {
      const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0)
      duePaisa = amountDueFromStored({ invoiceTotal: Number(invoice.totalAmount), paid, creditPaisa: returned?.totalPaisa ?? 0 })
      if (duePaisa <= 0) throw new OutcomeError(409, 'Nothing is left to collect on this invoice; record it as Delivered, Pay Later')
      if (chequePaisa !== null) {
        const mismatch = chequeAmountMismatch(chequePaisa, duePaisa)
        if (mismatch) throw new OutcomeError(400, mismatch, { amountDue: fromPaisa(duePaisa) })
      }
    }

    // A return credits AR today: refuse rather than post into a locked accounting period.
    if (returned && returned.lines.length > 0) {
      const settings = await getSettings(tx)
      if (settings.goLiveDate && now >= settings.goLiveDate) {
        try {
          assertNotLocked(settings, now)
        } catch {
          throw new OutcomeError(409, 'Cannot record a return: today falls in a locked accounting period')
        }
      }
    }

    // Claim (the lock above makes this the only writer; count 0 still guards against any path that skipped it).
    const target = outcomeOrderStatus(outcome)
    const claim = await tx.order.updateMany({ where: { id: order.id, status: 'OUT_FOR_DELIVERY' }, data: { status: target } })
    if (claim.count === 0) throw new OutcomeError(409, 'This delivery changed, reload and retry')

    const out: RecordOutcomeResult = { outcome }

    if (returned && returned.lines.length > 0) {
      const sr = await tx.salesReturn.create({
        data: {
          returnNumber: generateSalesReturnNumber(),
          retailerId: order.retailerId,
          returnDate: now,
          totalAmount: fromPaisa(returned.totalPaisa),
          notes: `Returned at delivery of order ${order.orderNumber}`,
          orderId: order.id,
          deliveryId: delivery.id,
          items: {
            create: returned.lines.map((l) => ({
              medicineId: l.medicineId,
              batchId: null,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
              restocked: false,
              reason: l.reason,
            })),
          },
        },
        select: { id: true },
      })
      out.salesReturnId = sr.id
    }

    if (PAYMENT_OUTCOMES.includes(outcome)) {
      if (input.method === 'CHEQUE') {
        const cheque = await createChequeRecord(
          actor,
          {
            direction: 'RECEIVABLE',
            chequeNumber: input.chequeNumber,
            amount: fromPaisa(chequePaisa!).toFixed(2), // the collector-entered amount (checked equal to the amount due)
            chequeDate: toDateInput(input.chequeDate),
            retailerId: order.retailerId,
            bankAccountId: input.bankAccountId,
            pictureUrl: input.pictureUrl,
            drawerBank: input.drawerBank,
            notes: `Collected at delivery of order ${order.orderNumber}`,
            allowDuplicate: input.allowDuplicate === true,
          },
          { tx, preAuthorised: true },
        )
        out.chequeId = cheque.id
      } else {
        const bankAccountId = input.method === 'BANK' ? input.bankAccountId!.trim() : null
        if (bankAccountId) await assertBankAccount(bankAccountId, tx)
        const c = await tx.deliveryCollection.create({
          data: {
            deliveryId: delivery.id,
            orderId: order.id,
            invoiceId: invoice.id,
            retailerId: order.retailerId,
            method: input.method!,
            amount: fromPaisa(duePaisa),
            bankAccountId,
            pictureUrl: input.pictureUrl!.trim(),
            collectedById: actor.id,
            collectedAt: now,
          },
          select: { id: true },
        })
        out.collectionId = c.id
      }
    }

    const holdUntil = outcome === 'ON_HOLD' ? (parseDateInput(toDateInput(input.holdUntil)) ?? new Date(input.holdUntil!)) : null
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        outcome,
        outcomeReason: outcome === 'RETURNED' || outcome === 'ON_HOLD' ? input.reason! : null,
        outcomeAt: now,
        outcomeById: actor.id,
        outcomePictureUrl: input.pictureUrl?.trim() || null,
        status: target,
        // ON_HOLD keeps the driver; the order shows up as Ready to Dispatch again on the new date.
        ...(holdUntil ? { scheduledDate: holdUntil } : {}),
        ...(target === 'DELIVERED' ? { deliveredAt: now } : {}),
      },
    })

    return { out, orderId: order.id }
  }, TX_OPTS)

  // SALES_RETURN posts the AR credit; DELIVERY_COGS is re-synced in case its date falls back to deliveredAt (an order
  // with no assignedAt, e.g. one converted from the old statuses).
  await syncAfterCommit([['SALES_RETURN', result.salesReturnId], ['DELIVERY_COGS', orderId]])
  return result
}
