// Pure delivery-outcome validation (no Prisma imports). Amounts are computed server-side in paisa.
import { karachiDayKey } from '@/lib/accounting/core'
import { toPaisa } from '@/lib/accounting/money'

export const OUTCOMES = ['PAID_FULL', 'PAID_WITH_RETURN', 'RETURNED', 'ON_HOLD', 'PAY_LATER'] as const
export type Outcome = (typeof OUTCOMES)[number]
export const RETURN_REASONS = ['Shop closed / refused', 'Wrong item', 'Damaged', 'Expired / short expiry', 'Price dispute', 'Other'] as const
export const HOLD_REASONS = ['Shop closed', 'Customer asked to come later', 'Address issue', 'Payment not ready', 'Other'] as const
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
  items: { id: string; quantity: number; unitPrice?: number; offerPercent?: number; salesTax?: number }[]
  totalAmount?: number // informational only; the amount due is recomputed from the lines
}

export type OutcomeResult =
  | { ok: true; amountDuePaisa: number; returnedLines: { orderItemId: string; quantity: number; reason?: string }[] }
  | { ok: false; error: string }

/**
 * Invoice total in paisa, same arithmetic as the sales invoice:
 *   line = round(qty x unitPrice x (1 - offer/100)); tax = round(salesTax x qty); total = sum of both over all lines.
 */
export function invoiceTotalPaisa(items: OutcomeOrder['items']): number {
  let t = 0
  for (const i of items) {
    t += toPaisa(i.quantity * (i.unitPrice ?? 0) * (1 - (i.offerPercent ?? 0) / 100))
    t += toPaisa((i.salesTax ?? 0) * i.quantity)
  }
  return t
}

/**
 * Credit for returned units, in paisa:
 *   perUnit = round(unitPrice x (1 - offer/100)) + round(salesTax);  credit = perUnit x returnedQty.
 * Amount due for Paid-with-Return = invoiceTotalPaisa - sum of credits (never below 0).
 */
export function returnCreditPaisa(item: OutcomeOrder['items'][number], qty: number): number {
  const perUnit = toPaisa((item.unitPrice ?? 0) * (1 - (item.offerPercent ?? 0) / 100)) + toPaisa(item.salesTax ?? 0)
  return perUnit * qty
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
  const total = invoiceTotalPaisa(order.items)
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
