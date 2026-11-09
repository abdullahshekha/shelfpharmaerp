// Pure acknowledgement rules (no Prisma imports), used by lib/deliveries/acknowledge.ts and lib/orders/lifecycle.ts.

export class AckError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Only ADMIN/MANAGER acknowledge collections and returned stock (spec calls 4, 7, 16). */
export function canAcknowledge(role: string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER'
}

function intPaisa(v: number, what: string): number {
  if (!Number.isFinite(v)) throw new Error(`Invalid ${what}: ${v}`)
  return Math.round(v)
}

/** Paisa still unpaid on an invoice after the given payments (paisa); never negative. Inputs are rounded to whole paisa. */
export function unpaidAfterPaymentsPaisa(invoiceTotalPaisa: number, paymentsPaisa: number[]): number {
  const total = intPaisa(invoiceTotalPaisa, 'invoice total')
  const paid = paymentsPaisa.reduce((s, p) => s + intPaisa(p, 'payment'), 0)
  return Math.max(0, total - paid)
}

/** Null when a collection of `amountPaisa` may be applied to an invoice with `unpaidPaisa` still due, else the reason. */
export function collectionAmountError(amountPaisa: number, unpaidPaisa: number): string | null {
  if (!(amountPaisa > 0)) return 'Collection amount must be greater than 0'
  if (amountPaisa > unpaidPaisa) {
    return `Collection amount exceeds the invoice's unpaid amount (Rs. ${(unpaidPaisa / 100).toFixed(2)} still due)`
  }
  return null
}

/** Same rule as the payment routes: paid >= total -> PAID, > 0 -> PARTIAL, else UNPAID. */
export function invoiceStatusFromPaisa(totalPaisa: number, paidPaisa: number): 'PAID' | 'PARTIAL' | 'UNPAID' {
  return paidPaisa >= totalPaisa ? 'PAID' : paidPaisa > 0 ? 'PARTIAL' : 'UNPAID'
}

/** DeliveryCollection.method -> Payment.method. */
export function collectionPaymentMethod(method: string): 'CASH' | 'BANK_TRANSFER' {
  if (method === 'CASH') return 'CASH'
  if (method === 'BANK') return 'BANK_TRANSFER'
  throw new Error(`Unknown collection method: ${method}`)
}

export type RestockLine = { id: string; medicineId: string; out: number }
export type ReturnedItem = { id: string; medicineId: string; quantity: number }
export type RestockPlanItem = { id: string; medicineId: string; restockQty: number; excess: number }

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Matches returned items to the order's lines by medicine (SalesReturnItem has no orderItemId). `out` = units of the
 * line still out of the warehouse (stillDeductedQty). Return items and lines are both taken in id order
 * (deterministic): each returned item consumes the out units of its medicine's lines, first line first, never taking a
 * line below 0. Returned units beyond what is recorded as out are not restocked (`excess`, reported as a warning).
 * `newDeducted` holds the new deductedQty only for lines whose value changed.
 */
export function planReturnRestock(lines: RestockLine[], returned: ReturnedItem[]): { items: RestockPlanItem[]; newDeducted: Map<string, number> } {
  const remaining = new Map<string, number>()
  const sortedLines = [...lines].sort(byId)
  for (const l of sortedLines) remaining.set(l.id, Math.max(0, Math.floor(l.out)))
  const newDeducted = new Map<string, number>()
  const items: RestockPlanItem[] = []
  for (const r of [...returned].sort(byId)) {
    let need = Math.max(0, Math.floor(r.quantity))
    let taken = 0
    for (const l of sortedLines) {
      if (need <= 0) break
      if (l.medicineId !== r.medicineId) continue
      const avail = remaining.get(l.id) ?? 0
      if (avail <= 0) continue
      const take = Math.min(avail, need)
      remaining.set(l.id, avail - take)
      newDeducted.set(l.id, avail - take)
      need -= take
      taken += take
    }
    items.push({ id: r.id, medicineId: r.medicineId, restockQty: taken, excess: need })
  }
  return { items, newDeducted }
}

export const ORDER_RETURN_BLOCK_MESSAGE = 'Order has a return; cannot cancel/delete'
export const ACK_COLLECTION_DELETE_MESSAGE = 'Paid by acknowledged collection; cannot delete.'

/**
 * An order with any delivery-linked sales return cannot be cancelled, un-delivered or hard-deleted: unacknowledged
 * returned stock would restock twice and an acknowledged one would leave its restock ledger entry orphaned.
 */
export function orderReturnBlock(deliveryReturnCount: number): string | null {
  return deliveryReturnCount > 0 ? ORDER_RETURN_BLOCK_MESSAGE : null
}

/** Spec call 9: a hard delete is refused once a collection on the order became a Payment (acknowledged). */
export function acknowledgedCollectionDeleteBlock(collections: { acknowledgedAt: Date | null }[]): string | null {
  return collections.some((c) => c.acknowledgedAt) ? ACK_COLLECTION_DELETE_MESSAGE : null
}

export const COLLECTION_DELETE_MESSAGE = 'Order has a delivery collection; acknowledge or resolve it first'
export const COLLECTION_CANCEL_MESSAGE = 'Order has a delivery collection; cannot cancel.'

/**
 * While ANY DeliveryCollection exists for an order (acknowledged or not) it cannot be hard-deleted, cancelled or
 * un-delivered: an unacknowledged one is the only record of cash a driver is holding, an acknowledged one is a Payment.
 * 'delete' keeps the spec call-9 message for an acknowledged collection.
 */
export function orderCollectionBlock(collections: { acknowledgedAt: Date | null }[], action: 'delete' | 'cancel'): string | null {
  if (collections.length === 0) return null
  if (action === 'cancel') return COLLECTION_CANCEL_MESSAGE
  return acknowledgedCollectionDeleteBlock(collections) ?? COLLECTION_DELETE_MESSAGE
}
