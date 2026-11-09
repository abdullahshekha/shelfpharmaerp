// Pure clearing rules (no Prisma singleton import, unit-testable).
import { AccountingError, assertNotLocked, karachiDayKey } from '@/lib/accounting/core'
import { toPaisa } from '@/lib/accounting/money'

export class PdcError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export type ClearingDateInput = {
  clearingDate: Date
  receivedDate: Date
  goLiveDate: Date | null
  lockedThrough: Date | null
  now: Date
}

/**
 * Throws unless the clearing date is allowed. All comparisons are Asia/Karachi calendar days:
 * on/after the received day, not after today, not before go-live (AccountingError 400),
 * not on/before lockedThrough (AccountingError 409).
 */
export function validateClearingDate(i: ClearingDateInput): void {
  if (!(i.clearingDate instanceof Date) || Number.isNaN(i.clearingDate.getTime())) {
    throw new PdcError(400, 'Valid clearing date is required')
  }
  const day = karachiDayKey(i.clearingDate)
  if (day < karachiDayKey(i.receivedDate)) {
    throw new PdcError(400, 'Clearing date cannot be before the date the cheque was received')
  }
  if (day > karachiDayKey(i.now)) throw new PdcError(400, 'Clearing date cannot be in the future')
  if (i.goLiveDate && day < karachiDayKey(i.goLiveDate)) {
    throw new AccountingError(400, 'Clearing date is before the accounting go-live date')
  }
  try {
    assertNotLocked({ lockedThrough: i.lockedThrough }, i.clearingDate)
  } catch (e) {
    throw new AccountingError(409, (e as Error).message)
  }
}

/** Converts a cheque amount (Decimal / string / number) to integer paisa exactly once; refuses <= 0 or invalid. */
export function chequeAmountPaisa(amount: unknown): number {
  const n = amount == null ? NaN : Number(typeof amount === 'object' ? String(amount) : amount)
  if (!Number.isFinite(n)) throw new PdcError(400, 'Cheque amount is invalid')
  const p = toPaisa(n)
  if (!Number.isSafeInteger(p) || p <= 0) throw new PdcError(400, 'Cheque amount must be greater than 0')
  return p
}
