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
  chequeAmount?: string | number // collector-entered; must equal the amount due
  drawerBank?: string
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

/** Takes `cut` paisa off `rows` in proportion to their credit (largest remainder, ties to the earlier row). */
function allocateCut(rows: { credit: number }[], cut: number): void {
  const sum = rows.reduce((s, r) => s + r.credit, 0)
  if (sum <= 0 || cut <= 0) return
  const take = Math.min(cut, sum)
  const shares = rows.map((r, idx) => {
    const exact = (r.credit * take) / sum
    return { idx, floor: Math.floor(exact), rem: exact - Math.floor(exact) }
  })
  let left = take - shares.reduce((s, x) => s + x.floor, 0)
  for (const s of [...shares].sort((x, y) => y.rem - x.rem || x.idx - y.idx)) {
    if (left <= 0) break
    s.floor += 1
    left -= 1
  }
  for (const s of shares) rows[s.idx].credit -= s.floor
}

/** Index of the row with the largest credit (first one on a tie), or -1 for no rows. */
function largestIdx(rows: { credit: number }[]): number {
  let best = -1
  rows.forEach((r, i) => {
    if (best < 0 || r.credit > rows[best].credit) best = i
  })
  return best
}

export type SalesReturnOptions = {
  /**
   * The STORED invoice total in paisa. When every line is returned in full, the credit is made to equal it exactly
   * (the stored total can differ from the line sums by a few paisa, e.g. after an admin edit).
   */
  invoiceTotalPaisa?: number
  /** Upper bound for the total credit in paisa (invoice total less credits already issued against this order). */
  capPaisa?: number
}

/**
 * Builds the Sales Return lines for returned order lines, with the credit computed the way the invoice was built
 * (see returnCreditPaisa: stored lineTotal + salesTaxAmount, pro rata, rounded in paisa).
 * - A partial line returns only the paid units it names.
 * - A fully returned line returns every unit that was shipped (deductedQty, else quantity + bonus).
 * - When EVERY line is returned in full (the Returned outcome) the total credit is brought to the invoice total:
 *   `opts.invoiceTotalPaisa` when given, else line sums less the order discount. A shortfall is taken off the lines
 *   in proportion to their credit (largest remainder in paisa); an excess (stored total above the line sums) is added
 *   to the largest line.
 * - The total credit never exceeds `opts.capPaisa` (any excess is taken off the largest lines first).
 * Lines are returned in `returned` order; a line of 0 units is left out. Throws on a line not in the order.
 */
export function buildSalesReturnLines(
  order: { items: ReturnSourceItem[]; discountAmount?: number },
  returned: { orderItemId: string; quantity: number; reason?: string | null }[],
  opts: SalesReturnOptions = {},
): { lines: SalesReturnLine[]; totalPaisa: number } {
  const all = returned.map((r) => {
    const item = order.items.find((i) => i.id === r.orderItemId)
    if (!item) throw new Error('Returned line does not belong to this order')
    const full = r.quantity >= item.quantity
    const units = full ? (item.deductedQty ? item.deductedQty : totalUnits(item)) : r.quantity
    return { item, full, units, credit: returnCreditPaisa(item, r.quantity), reason: r.reason?.trim() || null }
  })
  const rows = all.filter((r) => r.units > 0)

  const fullIds = new Set(all.filter((r) => r.full).map((r) => r.item.id))
  const wholeOrder = order.items.length > 0 && order.items.every((i) => fullIds.has(i.id))
  if (wholeOrder) {
    const sum = rows.reduce((s, r) => s + r.credit, 0)
    const target = Math.max(0, opts.invoiceTotalPaisa ?? sum - toPaisa(order.discountAmount ?? 0))
    if (target < sum) allocateCut(rows, sum - target)
    else if (target > sum && rows.length > 0) rows[largestIdx(rows)].credit += target - sum
  }

  if (opts.capPaisa !== undefined) {
    let excess = rows.reduce((s, r) => s + r.credit, 0) - Math.max(0, opts.capPaisa)
    while (excess > 0) {
      const i = largestIdx(rows)
      if (i < 0 || rows[i].credit <= 0) break
      const take = Math.min(excess, rows[i].credit)
      rows[i].credit -= take
      excess -= take
    }
  }

  const lines: SalesReturnLine[] = rows.map((r) => ({
    orderItemId: r.item.id,
    medicineId: r.item.medicineId,
    quantity: r.units,
    unitPrice: Math.round(r.credit / r.units) / 100,
    lineTotal: r.credit / 100,
    reason: r.reason,
  }))
  return { lines, totalPaisa: rows.reduce((s, r) => s + r.credit, 0) }
}

/** A domain error from recording an outcome; the route turns it into `status` + `{ error, ...extra }`. */
export class OutcomeError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}

/** 400 message when a door cheque's entered amount (paisa) is not the amount due, else null. */
export function chequeAmountMismatch(enteredPaisa: number, duePaisa: number): string | null {
  if (enteredPaisa === duePaisa) return null
  return `The cheque amount must equal the amount due (Rs. ${(duePaisa / 100).toFixed(2)}). For a cheque for a different amount, record the delivery as Delivered, Pay Later and record the cheque in PDC`
}

const OPT_STRING_FIELDS = ['method', 'pictureUrl', 'bankAccountId', 'chequeNumber', 'reason', 'drawerBank'] as const
const OPT_DATE_FIELDS = ['chequeDate', 'holdUntil'] as const

/**
 * Shape guard for an outcome request body (types only; the business rules are validateOutcomeInput's).
 * Returns an error message, or null when the body has the expected shape.
 */
export function outcomeBodyError(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Invalid request body'
  const b = body as Record<string, unknown>
  if (typeof b.outcome !== 'string') return 'outcome is required'
  for (const f of OPT_STRING_FIELDS) {
    if (b[f] !== undefined && b[f] !== null && typeof b[f] !== 'string') return `${f} must be text`
  }
  for (const f of OPT_DATE_FIELDS) {
    const v = b[f]
    if (v !== undefined && v !== null && typeof v !== 'string' && !(v instanceof Date)) return `${f} must be a date`
  }
  if (b.chequeAmount !== undefined && b.chequeAmount !== null && typeof b.chequeAmount !== 'string' && typeof b.chequeAmount !== 'number') {
    return 'chequeAmount must be a number'
  }
  if (b.allowDuplicate !== undefined && typeof b.allowDuplicate !== 'boolean') return 'allowDuplicate must be true or false'
  if (b.returnedLines !== undefined && b.returnedLines !== null) {
    if (!Array.isArray(b.returnedLines)) return 'returnedLines must be a list'
    for (const l of b.returnedLines) {
      if (!l || typeof l !== 'object' || Array.isArray(l)) return 'Invalid returned line'
      const r = l as Record<string, unknown>
      if (typeof r.orderItemId !== 'string') return 'Each returned line needs an orderItemId'
      if (typeof r.quantity !== 'number') return 'Each returned line needs a numeric quantity'
      if (r.reason !== undefined && r.reason !== null && typeof r.reason !== 'string') return 'A returned line reason must be text'
    }
  }
  return null
}
