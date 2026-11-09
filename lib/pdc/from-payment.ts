// Pure mapping from an invoice payment-screen body to a cheque input. No Prisma/db imports.
import type { ChequeDirection } from './rules'

export class PaymentChequeError extends Error {
  status = 400
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * The invoice picked on the payment screen is only the party selector: the cheque is for the
 * invoice's customer (RECEIVABLE) or supplier (PAYABLE), not tied to that invoice.
 */
export function chequeInputFromPayment(
  body: Record<string, unknown>,
  invoice: { retailerId?: string | null; supplierId?: string | null },
  direction: ChequeDirection,
) {
  const chequeNumber = str(body.reference)
  if (!chequeNumber) throw new PaymentChequeError('Cheque number is required')
  return {
    direction,
    chequeNumber,
    amount: body.amount,
    chequeDate: str(body.chequeDate) ?? body.paymentDate,
    // The payment screen's Date is when the cheque was received/issued; without it a back-dated cheque would get
    // receivedDate = now and could not be cleared with the earlier date.
    receivedDate: str(body.paymentDate),
    allowDuplicate: body.allowDuplicate === true,
    retailerId: direction === 'RECEIVABLE' ? invoice.retailerId ?? null : null,
    supplierId: direction === 'PAYABLE' ? invoice.supplierId ?? null : null,
    bankAccountId: str(body.bankAccountId),
    notes: body.notes,
  }
}

/** Upper-cased payment method, defaulting to CASH, so 'cheque' cannot bypass the pending-cheque path. */
export function normalizePaymentMethod(v: unknown): string {
  return String(v ?? 'CASH').toUpperCase()
}
