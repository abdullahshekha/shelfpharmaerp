// Pure delivery-outcome validation (no Prisma imports). Amounts are computed server-side in paisa.
import { karachiDayKey } from '@/lib/accounting/core'
import { toPaisa } from '@/lib/accounting/money'
import { totalUnits } from '@/lib/orders/units'

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

// ---- Who may record an outcome ----

const OUTCOME_MANAGER_ROLES = ['ADMIN', 'MANAGER']

/** ADMIN/MANAGER may record the outcome of any delivery; anyone else only of a delivery assigned to them. */
export function canRecordOutcome(actor: { id: string; role: string } | null | undefined, delivery: { driverId: string | null }): boolean {
  if (!actor?.id) return false
  if (OUTCOME_MANAGER_ROLES.includes(actor.role)) return true
  return !!delivery.driverId && delivery.driverId === actor.id
}

/** The order status an outcome moves an OUT_FOR_DELIVERY order to. */
export function outcomeOrderStatus(outcome: Outcome): 'DELIVERED' | 'RETURNED' | 'ON_HOLD' {
  if (outcome === 'RETURNED') return 'RETURNED'
  if (outcome === 'ON_HOLD') return 'ON_HOLD'
  return 'DELIVERED'
}

/**
 * What is still to collect, in paisa: the STORED invoice total, less payments already recorded on the invoice and the
 * return credit (Paid with Return), never below 0.
 */
export function amountDueFromStored(a: { invoiceTotal: number; paid: number; creditPaisa: number }): number {
  return Math.max(0, toPaisa(a.invoiceTotal) - toPaisa(a.paid) - a.creditPaisa)
}

// ---- Sales-return lines for a delivery return ----

export type ReturnSourceItem = OutcomeOrder['items'][number] & {
  medicineId: string
  bonusQty?: number | null
  deductedQty?: number | null
}

export type SalesReturnLine = {
  orderItemId: string
  medicineId: string
  quantity: number // units coming back (a fully returned line brings back its shipped bonus units too)
  unitPrice: number // rupees, credit per unit (tax-inclusive), rounded to paisa
  lineTotal: number // rupees, the credit for this line
  reason: string | null
}

/**
 * Builds the Sales Return lines for returned order lines, with the credit computed the way the invoice was built
 * (see returnCreditPaisa: stored lineTotal + salesTaxAmount, pro rata, rounded in paisa).
 * - A partial line returns only the paid units it names.
 * - A fully returned line returns every unit that was shipped (deductedQty, else quantity + bonus).
 * - When EVERY line is returned in full (the Returned outcome) the order-level discount is allocated across the lines
 *   (by credit, largest remainder in paisa), so the total credit equals the invoice total exactly.
 * Lines are returned in `returned` order; a line of 0 units is left out. Throws on a line not in the order.
 */
export function buildSalesReturnLines(
  order: { items: ReturnSourceItem[]; discountAmount?: number },
  returned: { orderItemId: string; quantity: number; reason?: string | null }[],
): { lines: SalesReturnLine[]; totalPaisa: number } {
  const rows = returned.map((r) => {
    const item = order.items.find((i) => i.id === r.orderItemId)
    if (!item) throw new Error('Returned line does not belong to this order')
    const full = r.quantity >= item.quantity
    const units = full ? (item.deductedQty ? item.deductedQty : totalUnits(item)) : r.quantity
    return { item, full, units, credit: returnCreditPaisa(item, r.quantity), reason: r.reason?.trim() || null }
  })

  const fullIds = new Set(rows.filter((r) => r.full).map((r) => r.item.id))
  const wholeOrder = order.items.length > 0 && order.items.every((i) => fullIds.has(i.id))
  const discount = toPaisa(order.discountAmount ?? 0)
  if (wholeOrder && discount > 0) {
    const sum = rows.reduce((s, r) => s + r.credit, 0)
    const cut = Math.min(discount, sum)
    if (sum > 0 && cut > 0) {
      const shares = rows.map((r, idx) => {
        const exact = (r.credit * cut) / sum
        return { idx, floor: Math.floor(exact), rem: exact - Math.floor(exact) }
      })
      let left = cut - shares.reduce((s, x) => s + x.floor, 0)
      const byRem = [...shares].sort((a, b) => b.rem - a.rem || a.idx - b.idx)
      for (const s of byRem) {
        if (left <= 0) break
        s.floor += 1
        left -= 1
      }
      for (const s of shares) rows[s.idx].credit -= s.floor
    }
  }

  const lines: SalesReturnLine[] = rows
    .filter((r) => r.units > 0)
    .map((r) => ({
      orderItemId: r.item.id,
      medicineId: r.item.medicineId,
      quantity: r.units,
      unitPrice: Math.round(r.credit / r.units) / 100,
      lineTotal: r.credit / 100,
      reason: r.reason,
    }))
  return { lines, totalPaisa: rows.filter((r) => r.units > 0).reduce((s, r) => s + r.credit, 0) }
}

/** A domain error from recording an outcome; the route turns it into `status` + `{ error, ...extra }`. */
export class OutcomeError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}
