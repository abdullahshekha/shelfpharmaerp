// Pure posting builders: plain inputs (Numbers, no Prisma) -> journal entries. No DB access.
// Task 3 (sync) loads records, maps them to these shapes and posts the result.
import { assertBalanced, type LineInput } from './core'
import { fromPaisa, toPaisa } from './money'

export type BuiltEntry = { date: Date; memo: string; lines: LineInput[] }

const p = (n: number | null | undefined) => toPaisa(n ?? 0)

const MAX_DRIFT_PAISA = 100

/** Drops zero-amount lines (negatives are kept so they throw); returns [] if nothing is left; throws if unbalanced. */
function finish(date: Date, memo: string, lines: LineInput[]): BuiltEntry[] {
  const kept = lines.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0)
  if (kept.length === 0) return []
  assertBalanced(kept)
  return [{ date, memo, lines: kept }]
}

const cashKey = (method: string): 'CASH' | 'BANK' => (method === 'CASH' ? 'CASH' : 'BANK')

// ---- Sales invoice ----
export interface InvoiceInput {
  invoiceNumber: string
  invoiceDate: Date
  retailerId: string
  subtotal: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
}

export function buildInvoice(inv: InvoiceInput): BuiltEntry[] {
  const total = p(inv.totalAmount)
  const tax = p(inv.taxAmount)
  // Normally equals subtotal - discount; any stored-data difference is absorbed into Sales so the entry ties.
  const sales = total - tax
  const drift = sales - (p(inv.subtotal) - p(inv.discountAmount))
  if (Math.abs(drift) > MAX_DRIFT_PAISA) {
    throw new Error(`Sales invoice ${inv.invoiceNumber}: total does not tie to subtotal - discount + tax (off by ${fromPaisa(drift)})`)
  }
  return finish(inv.invoiceDate, `Sales invoice ${inv.invoiceNumber}`, [
    { accountKey: 'AR', debit: fromPaisa(total), retailerId: inv.retailerId },
    { accountKey: 'SALES', credit: fromPaisa(sales) },
    { accountKey: 'SALES_TAX_PAYABLE', credit: fromPaisa(tax) },
  ])
}

// ---- Cost of goods sold at delivery ----
export interface DeliveryCogsInput {
  orderNumber: string
  /** delivery.deliveredAt ?? order.updatedAt */
  date: Date
  items: { quantity: number; unitCost: number | null }[]
}

export function buildDeliveryCogs(order: DeliveryCogsInput): BuiltEntry[] {
  let total = 0
  for (const i of order.items) {
    if (i.unitCost == null) continue
    total += p(i.quantity * i.unitCost)
  }
  return finish(order.date, `Cost of goods sold, order ${order.orderNumber}`, [
    { accountKey: 'COGS', debit: fromPaisa(total) },
    { accountKey: 'INVENTORY', credit: fromPaisa(total) },
  ])
}

// ---- Customer payment ----
export interface CustomerPaymentInput {
  paymentDate: Date
  amount: number
  method: string
  retailerId: string
  reference?: string | null
  invoiceNumber?: string | null
}

export function buildCustomerPayment(pay: CustomerPaymentInput): BuiltEntry[] {
  const amt = fromPaisa(p(pay.amount))
  const ref = pay.invoiceNumber ? ` against ${pay.invoiceNumber}` : pay.reference ? ` (${pay.reference})` : ''
  return finish(pay.paymentDate, `Customer payment${ref}`, [
    { accountKey: cashKey(pay.method), debit: amt },
    { accountKey: 'AR', credit: amt, retailerId: pay.retailerId },
  ])
}

// ---- Sales return ----
export interface SalesReturnInput {
  returnNumber: string
  returnDate: Date
  retailerId: string
  totalAmount: number
  items: { quantity: number; restocked: boolean; batchPurchasePrice: number | null }[]
}

export function buildSalesReturn(r: SalesReturnInput): BuiltEntry[] {
  const total = fromPaisa(p(r.totalAmount))
  const out = finish(r.returnDate, `Sales return ${r.returnNumber}`, [
    { accountKey: 'SALES_RETURNS', debit: total },
    { accountKey: 'AR', credit: total, retailerId: r.retailerId },
  ])
  let cost = 0
  for (const i of r.items) {
    if (!i.restocked || i.batchPurchasePrice == null) continue
    cost += p(i.quantity * i.batchPurchasePrice)
  }
  out.push(
    ...finish(r.returnDate, `Restocked goods, sales return ${r.returnNumber}`, [
      { accountKey: 'INVENTORY', debit: fromPaisa(cost) },
      { accountKey: 'COGS', credit: fromPaisa(cost) },
    ]),
  )
  return out
}

// ---- Purchase invoice ----
export interface PurchaseInvoiceInput {
  invoiceNumber: string
  invoiceDate: Date
  supplierId: string
  totalAmount: number
  items: { lineTotal: number; salesTaxAmount: number; aitCollectibleAmount: number; aitPayableAmount: number }[]
}

export function buildPurchaseInvoice(pi: PurchaseInvoiceInput): BuiltEntry[] {
  let inv = 0
  let st = 0
  let aitC = 0
  let aitP = 0
  for (const i of pi.items) {
    inv += p(i.lineTotal)
    st += p(i.salesTaxAmount)
    aitC += p(i.aitCollectibleAmount)
    aitP += p(i.aitPayableAmount)
  }
  const total = p(pi.totalAmount)
  // total = inv + st - aitC + aitP by the invoice formula; stored-rounding drift is absorbed into Inventory.
  const drift = total - (inv + st - aitC + aitP)
  if (Math.abs(drift) > MAX_DRIFT_PAISA) {
    throw new Error(`Purchase invoice ${pi.invoiceNumber}: total does not tie to its lines (off by ${fromPaisa(drift)})`)
  }
  inv += drift
  return finish(pi.invoiceDate, `Purchase invoice ${pi.invoiceNumber}`, [
    { accountKey: 'INVENTORY', debit: fromPaisa(inv) },
    { accountKey: 'SALES_TAX_INPUT', debit: fromPaisa(st) },
    { accountKey: 'ADV_TAX_RECOVERABLE', debit: fromPaisa(aitP) },
    { accountKey: 'ADV_TAX_COLLECTED', credit: fromPaisa(aitC) },
    { accountKey: 'AP', credit: fromPaisa(total), supplierId: pi.supplierId },
  ])
}

// ---- Supplier payment ----
export interface SupplierPaymentInput {
  paymentDate: Date
  amount: number
  method: string
  supplierId: string
  invoiceNumber?: string | null
}

export function buildSupplierPayment(pay: SupplierPaymentInput): BuiltEntry[] {
  const amt = fromPaisa(p(pay.amount))
  const ref = pay.invoiceNumber ? ` against ${pay.invoiceNumber}` : ''
  return finish(pay.paymentDate, `Supplier payment${ref}`, [
    { accountKey: 'AP', debit: amt, supplierId: pay.supplierId },
    { accountKey: cashKey(pay.method), credit: amt },
  ])
}

// ---- Supplier return ----
export interface SupplierReturnInput {
  returnNumber: string
  returnDate: Date
  supplierId: string
  totalAmount: number
}

export function buildSupplierReturn(r: SupplierReturnInput): BuiltEntry[] {
  const amt = fromPaisa(p(r.totalAmount))
  return finish(r.returnDate, `Supplier return ${r.returnNumber}`, [
    { accountKey: 'AP', debit: amt, supplierId: r.supplierId },
    { accountKey: 'INVENTORY', credit: amt },
  ])
}

// ---- Stock batch write-off (batch deleted while the module is live) ----
// Posted by lib/inventory/batch-delete.ts as sourceType BATCH_WRITEOFF (sourceId = batch id). Not a sync SOURCE_TYPE:
// sync/rebuild never touch it, same family as DEPRECIATION / PAYROLL.
export interface BatchWriteoffInput {
  date: Date
  medicineName: string
  batchNumber: string
  /** units physically disappearing: the batch's currentQty at deletion time */
  quantity: number
  purchasePrice: number
}

export function buildBatchWriteoff(b: BatchWriteoffInput): BuiltEntry[] {
  if (!(b.quantity > 0) || !(b.purchasePrice > 0)) return []
  const memo = `Stock write-off: ${b.medicineName} batch ${b.batchNumber} (${b.quantity} units)`
  const amt = fromPaisa(p(b.quantity * b.purchasePrice))
  return finish(b.date, memo, [
    { accountKey: 'OTHER_EXPENSES', debit: amt, memo },
    { accountKey: 'INVENTORY', credit: amt },
  ])
}
