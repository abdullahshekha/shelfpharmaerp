// Pure delivery-outcome validation (no Prisma imports). Amounts are computed server-side in paisa.
import { karachiDayKey } from '@/lib/accounting/core'
import { toPaisa } from '@/lib/accounting/money'

export const OUTCOMES = ['PAID_FULL', 'PAID_WITH_RETURN', 'RETURNED', 'ON_HOLD', 'PAY_LATER'] as const
export type Outcome = (typeof OUTCOMES)[number]
export const RETURN_REASONS = ['no cash', 'not required', 'wrong order', 'late'] as const
export const HOLD_REASONS = ['no cash', 'shop closed'] as const
export const PAYMENT_METHODS = ['CASH', 'BANK', 'CHEQUE'] as const

export type OutcomeInput = {
  outcome: string
  method?: string
  pictureUrl?: string
  bankAccountId?: string
  chequeNumber?: string
  chequeDate?: string | Date
  returnedLines?: { orderItemId: string; quantity: number; reason?: string }[]
  reason?: string
  holdUntil?: string | Date
}

export type OutcomeOrder = {
  // Stored OrderItem values (the invoice is built from these, see lib/orders/set-status.ts)
  items: { id: string; quantity: number; lineTotal: number; salesTaxAmount: number }[]
  discountAmount?: number // order-level discount
}

export type OutcomeResult =
  | { ok: true; amountDuePaisa: number; returnedLines: { orderItemId: string; quantity: number; reason?: string }[] }
  | { ok: false; error: string }

/**
 * Invoice total in paisa, exactly as the invoice is built:
 *   sum(stored lineTotal) - order discountAmount + sum(stored salesTaxAmount), each converted to paisa.
 */
export function invoiceTotalPaisa(order: OutcomeOrder): number {
  let t = 0
  for (const i of order.items) t += toPaisa(i.lineTotal) + toPaisa(i.salesTaxAmount)
  return t - toPaisa(order.discountAmount ?? 0)
}

/**
 * Credit for returned units of one line, in paisa:
 *   round(lineTotalPaisa x returnedQty / qty) + round(salesTaxAmountPaisa x returnedQty / qty).
 * Returning the full quantity credits the stored lineTotal and salesTaxAmount exactly (no rounding drift).
 * The order-level discount is not credited back on returns.
 */
export function returnCreditPaisa(item: OutcomeOrder['items'][number], qty: number): number {
  const lt = toPaisa(item.lineTotal)
  const st = toPaisa(item.salesTaxAmount)
  if (qty >= item.quantity) return lt + st
  return Math.round((lt * qty) / item.quantity) + Math.round((st * qty) / item.quantity)
}

const fail = (error: string): OutcomeResult => ({ ok: false, error })
const blank = (s?: string) => !s || !s.trim()

function validatePayment(i: OutcomeInput): string | null {
  if (!i.method || !(PAYMENT_METHODS as readonly string[]).includes(i.method)) return 'Payment method must be CASH, BANK or CHEQUE'
  if (i.method === 'CHEQUE') {
    if (blank(i.chequeNumber)) return 'Cheque number is required'
    if (!i.chequeDate || Number.isNaN(new Date(i.chequeDate).getTime())) return 'Cheque date is required'
  }
  if (i.method === 'BANK' && blank(i.bankAccountId)) return 'Bank account is required'
  if (blank(i.pictureUrl)) return 'A picture is required as proof'
  return null
}

export function validateOutcomeInput(input: OutcomeInput, order: OutcomeOrder, now: Date): OutcomeResult {
  const total = Math.max(0, invoiceTotalPaisa(order))
  switch (input.outcome) {
    case 'PAID_FULL': {
      const e = validatePayment(input)
      return e ? fail(e) : { ok: true, amountDuePaisa: total, returnedLines: [] }
    }
    case 'PAID_WITH_RETURN': {
      const lines = input.returnedLines ?? []
      if (lines.length === 0) return fail('At least one returned line is required')
      const seen = new Set<string>()
      let credit = 0
      let allReturned = true
      for (const l of lines) {
        const item = order.items.find((x) => x.id === l.orderItemId)
        if (!item) return fail('Returned line does not belong to this order')
        if (seen.has(l.orderItemId)) return fail('Duplicate returned line')
        seen.add(l.orderItemId)
        if (!Number.isInteger(l.quantity) || l.quantity <= 0) return fail('Returned quantity must be a positive whole number')
        if (l.quantity > item.quantity) return fail('Returned quantity cannot exceed the ordered quantity')
        if (l.reason !== undefined && l.reason !== '' && !(RETURN_REASONS as readonly string[]).includes(l.reason)) return fail('Invalid return reason on a returned line')
        if (l.quantity < item.quantity) allReturned = false
        credit += returnCreditPaisa(item, l.quantity)
      }
      if (allReturned && seen.size === order.items.length) return fail('All units returned: use the Returned outcome instead')
      const e = validatePayment(input)
      if (e) return fail(e)
      return {
        ok: true,
        amountDuePaisa: Math.max(0, total - credit),
        returnedLines: lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity, ...(l.reason ? { reason: l.reason } : {}) })),
      }
    }
    case 'RETURNED':
      if (!input.reason || !(RETURN_REASONS as readonly string[]).includes(input.reason)) return fail('A valid return reason is required')
      return { ok: true, amountDuePaisa: 0, returnedLines: [] }
    case 'ON_HOLD': {
      if (!input.reason || !(HOLD_REASONS as readonly string[]).includes(input.reason)) return fail('A valid hold reason is required')
      const until = input.holdUntil ? new Date(input.holdUntil) : null
      if (!until || Number.isNaN(until.getTime())) return fail('A hold-until date is required')
      if (karachiDayKey(until) < karachiDayKey(now)) return fail('Hold-until date cannot be in the past')
      return { ok: true, amountDuePaisa: 0, returnedLines: [] }
    }
    case 'PAY_LATER':
      return { ok: true, amountDuePaisa: total, returnedLines: [] }
    default:
      return fail('Unknown outcome')
  }
}
