// Clearing a PDC cheque: claim it, pay the party's oldest unpaid invoices, post via sync after commit.
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/accounting/core'
import { syncSafe } from '@/lib/accounting/sync'
import { toPaisa } from '@/lib/accounting/money'
import { invoiceDuePaisa, OUTSTANDING_STATUSES } from '@/lib/utils/outstanding'
import { allocateOldestFirst, type OpenInvoice } from './rules'
import { canManageCheques } from './guard'
import { assertBankAccount, ChequeError } from './create'
import { PdcError, validateClearingDate, chequeAmountPaisa } from './clear-rules'

export { PdcError, validateClearingDate, chequeAmountPaisa } from './clear-rules'

const SUPPLIER_OPEN_STATUSES = ['UNPAID', 'PARTIAL']

const rupees = (paisa: number) => (paisa / 100).toFixed(2)

type Planned = { invoiceId: string; paisa: number; newStatus: 'PAID' | 'PARTIAL' }

export async function clearCheque(
  chequeId: string,
  actor: { id: string; role: string },
  opts: { clearingDate?: Date; bankAccountId?: string } = {},
): Promise<{ payments: { id: string; invoiceId: string; amount: number }[] }> {
  if (!actor.id || !canManageCheques(actor.role)) throw new PdcError(403, 'Forbidden')
  const clearingDate = opts.clearingDate ?? new Date()

  // Cheap pre-checks (re-checked inside the transaction under the party lock).
  const pre = await prisma.cheque.findUnique({ where: { id: chequeId } })
  if (!pre) throw new PdcError(404, 'Cheque not found')
  if (pre.status !== 'PENDING') throw new PdcError(409, `Cannot clear a ${pre.status} cheque`)
  if (!pre.acknowledgedAt) throw new PdcError(409, 'The cheque must be acknowledged before it can be cleared')
  const bankAccountId = opts.bankAccountId || pre.bankAccountId
  if (!bankAccountId) throw new PdcError(400, 'Choose the bank account the cheque was cleared into')
  // The ledger posts to this account as-is (no fallback), so it must still be an active bank account now.
  try {
    await assertBankAccount(bankAccountId)
  } catch (e) {
    if (e instanceof ChequeError) throw new PdcError(e.status, e.message)
    throw e
  }
  const receivable = pre.direction === 'RECEIVABLE'
  const partyId = receivable ? pre.retailerId : pre.supplierId
  if (!partyId) throw new PdcError(400, 'The cheque has no customer/supplier')

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Serialise every clearing for this party.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'PDC_PARTY:' + partyId}))`

      // 2. Fresh read under the lock, then validate against current settings.
      const cheque = await tx.cheque.findUnique({ where: { id: chequeId } })
      if (!cheque) throw new PdcError(404, 'Cheque not found')
      if (cheque.status !== 'PENDING') throw new PdcError(409, `Cannot clear a ${cheque.status} cheque`)
      if (!cheque.acknowledgedAt) throw new PdcError(409, 'The cheque must be acknowledged before it can be cleared')
      if (cheque.direction !== pre.direction || (receivable ? cheque.retailerId : cheque.supplierId) !== partyId) {
        throw new PdcError(409, 'Cheque changed, reload and retry')
      }
      if (!opts.bankAccountId && cheque.bankAccountId !== bankAccountId) {
        throw new PdcError(409, 'Cheque changed, reload and retry')
      }
      const settings = await getSettings(tx)
      validateClearingDate({
        clearingDate,
        receivedDate: cheque.receivedDate,
        goLiveDate: settings.goLiveDate,
        lockedThrough: settings.lockedThrough,
        now: new Date(),
      })
      const amountPaisa = chequeAmountPaisa(cheque.amount)

      // 3. Claim: only one clearer can move PENDING -> CLEARED; updatedAt guards against a concurrent edit.
      const claim = await tx.cheque.updateMany({
        where: { id: chequeId, status: 'PENDING', updatedAt: cheque.updatedAt },
        data: { status: 'CLEARED', clearedAt: clearingDate, clearedById: actor.id, bankAccountId },
      })
      if (claim.count === 0) throw new PdcError(409, 'Cheque was already cleared or changed, reload and retry')

      // 4. Open invoices, loaded fresh inside the lock.
      const open: (OpenInvoice & { totalPaisa: number; paidPaisa: number })[] = []
      if (receivable) {
        const invoices = await tx.invoice.findMany({
          where: { retailerId: partyId, status: { in: [...OUTSTANDING_STATUSES] } },
          select: { id: true, status: true, totalAmount: true, invoiceDate: true, createdAt: true, payments: { select: { amount: true } } },
        })
        for (const inv of invoices) {
          const duePaisa = invoiceDuePaisa(inv)
          const totalPaisa = toPaisa(Number(inv.totalAmount))
          open.push({ id: inv.id, duePaisa, sortDate: inv.invoiceDate, createdAt: inv.createdAt, totalPaisa, paidPaisa: totalPaisa - duePaisa })
        }
      } else {
        const invoices = await tx.purchaseInvoice.findMany({
          where: { supplierId: partyId, status: { in: SUPPLIER_OPEN_STATUSES } },
          select: { id: true, totalAmount: true, invoiceDate: true, createdAt: true, payments: { select: { amount: true } } },
        })
        for (const inv of invoices) {
          const totalPaisa = toPaisa(Number(inv.totalAmount))
          const paidPaisa = inv.payments.reduce((s, p) => s + toPaisa(Number(p.amount)), 0)
          open.push({ id: inv.id, duePaisa: Math.max(0, totalPaisa - paidPaisa), sortDate: inv.invoiceDate, createdAt: inv.createdAt, totalPaisa, paidPaisa })
        }
      }

      const { allocations, remainderPaisa } = allocateOldestFirst(open, amountPaisa)
      // No credit/prepayment ever: throwing rolls back the claim too.
      if (remainderPaisa > 0) throw new PdcError(409, 'Cheque amount exceeds unpaid invoices')

      const byId = new Map(open.map((o) => [o.id, o]))
      const planned: Planned[] = allocations.map((a) => {
        const inv = byId.get(a.invoiceId)!
        return { invoiceId: a.invoiceId, paisa: a.paisa, newStatus: inv.paidPaisa + a.paisa >= inv.totalPaisa ? 'PAID' : 'PARTIAL' }
      })

      // 5. One payment per allocation + invoice status.
      const created: { id: string; invoiceId: string; amount: number }[] = []
      for (const p of planned) {
        const common = {
          amount: rupees(p.paisa),
          paymentDate: clearingDate,
          method: 'CHEQUE',
          reference: cheque.chequeNumber,
          chequeId: cheque.id,
          bankAccountId,
        }
        if (receivable) {
          const pay = await tx.payment.create({ data: { ...common, retailerId: partyId, invoiceId: p.invoiceId }, select: { id: true } })
          await tx.invoice.update({ where: { id: p.invoiceId }, data: { status: p.newStatus } })
          created.push({ id: pay.id, invoiceId: p.invoiceId, amount: p.paisa / 100 })
        } else {
          const pay = await tx.supplierPayment.create({ data: { ...common, supplierId: partyId, purchaseInvoiceId: p.invoiceId }, select: { id: true } })
          await tx.purchaseInvoice.update({ where: { id: p.invoiceId }, data: { status: p.newStatus } })
          created.push({ id: pay.id, invoiceId: p.invoiceId, amount: p.paisa / 100 })
        }
      }
      return created
    },
    { maxWait: 10000, timeout: 20000 },
  )

  // Post to the ledger after commit (never throws; a missed hook is healed by Rebuild).
  for (const p of result) await syncSafe(receivable ? 'PAYMENT' : 'SUPPLIER_PAYMENT', p.id)
  return { payments: result }
}
