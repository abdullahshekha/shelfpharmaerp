import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertBalanced, type LineInput } from '../../lib/accounting/core'
import { toPaisa } from '../../lib/accounting/money'
import {
  buildInvoice,
  buildDeliveryCogs,
  buildCustomerPayment,
  buildSalesReturn,
  buildPurchaseInvoice,
  buildSupplierPayment,
  buildSupplierReturn,
} from '../../lib/accounting/builders'

const D = new Date('2026-10-11T08:00:00Z')

function sum(lines: LineInput[], key: string, side: 'debit' | 'credit') {
  return lines.filter((l) => l.accountKey === key).reduce((s, l) => s + toPaisa(l[side] ?? 0), 0) / 100
}

test('invoice with tax', () => {
  const r = buildInvoice({ invoiceNumber: 'SP-INV-1', invoiceDate: D, retailerId: 'r1', subtotal: 1000, discountAmount: 50, taxAmount: 95, totalAmount: 1045 })
  assert.equal(r.length, 1)
  assert.equal(r[0].date, D)
  assert.match(r[0].memo, /SP-INV-1/)
  assertBalanced(r[0].lines)
  assert.equal(sum(r[0].lines, 'AR', 'debit'), 1045)
  assert.equal(sum(r[0].lines, 'SALES', 'credit'), 950)
  assert.equal(sum(r[0].lines, 'SALES_TAX_PAYABLE', 'credit'), 95)
  assert.equal(r[0].lines.find((l) => l.accountKey === 'AR')!.retailerId, 'r1')
})

test('invoice zero tax omits tax line', () => {
  const r = buildInvoice({ invoiceNumber: 'X', invoiceDate: D, retailerId: 'r1', subtotal: 500, discountAmount: 0, taxAmount: 0, totalAmount: 500 })
  assert.equal(r[0].lines.length, 2)
  assertBalanced(r[0].lines)
})

test('invoice stored-data mismatch goes to SALES', () => {
  const r = buildInvoice({ invoiceNumber: 'X', invoiceDate: D, retailerId: 'r1', subtotal: 500, discountAmount: 0, taxAmount: 10, totalAmount: 511 })
  assertBalanced(r[0].lines)
  assert.equal(sum(r[0].lines, 'SALES', 'credit'), 501)
})

test('zero invoice returns nothing', () => {
  assert.deepEqual(buildInvoice({ invoiceNumber: 'X', invoiceDate: D, retailerId: 'r1', subtotal: 0, discountAmount: 0, taxAmount: 0, totalAmount: 0 }), [])
})

test('delivery cogs', () => {
  const r = buildDeliveryCogs({ orderNumber: 'SP-1', date: D, items: [{ quantity: 3, unitCost: 10.333 }, { quantity: 2, unitCost: 5 }] })
  assert.equal(r.length, 1)
  assertBalanced(r[0].lines)
  assert.equal(sum(r[0].lines, 'COGS', 'debit'), 41)
  assert.equal(sum(r[0].lines, 'INVENTORY', 'credit'), 41)
})

test('null unitCost yields no cogs entry', () => {
  assert.deepEqual(buildDeliveryCogs({ orderNumber: 'SP-1', date: D, items: [{ quantity: 3, unitCost: null }] }), [])
  const r = buildDeliveryCogs({ orderNumber: 'SP-1', date: D, items: [{ quantity: 3, unitCost: null }, { quantity: 1, unitCost: 7 }] })
  assert.equal(sum(r[0].lines, 'COGS', 'debit'), 7)
})

test('customer payment cash vs bank', () => {
  const c = buildCustomerPayment({ paymentDate: D, amount: 200, method: 'CASH', retailerId: 'r1', reference: 'R1' })
  const b = buildCustomerPayment({ paymentDate: D, amount: 200, method: 'BANK_TRANSFER', retailerId: 'r1' })
  const q = buildCustomerPayment({ paymentDate: D, amount: 200, method: 'CHEQUE', retailerId: 'r1' })
  assertBalanced(c[0].lines); assertBalanced(b[0].lines)
  assert.equal(sum(c[0].lines, 'CASH', 'debit'), 200)
  assert.equal(sum(b[0].lines, 'BANK', 'debit'), 200)
  assert.equal(sum(q[0].lines, 'BANK', 'debit'), 200)
  assert.equal(sum(c[0].lines, 'AR', 'credit'), 200)
  assert.equal(c[0].lines.find((l) => l.accountKey === 'AR')!.retailerId, 'r1')
  assert.deepEqual(buildCustomerPayment({ paymentDate: D, amount: 0, method: 'CASH', retailerId: 'r1' }), [])
})

test('sales return restocked vs not', () => {
  const base = { returnNumber: 'SP-SRET-1', returnDate: D, retailerId: 'r1', totalAmount: 300 }
  const none = buildSalesReturn({ ...base, items: [{ quantity: 3, restocked: false, batchPurchasePrice: 60 }] })
  assert.equal(none.length, 1)
  assertBalanced(none[0].lines)
  assert.equal(sum(none[0].lines, 'SALES_RETURNS', 'debit'), 300)
  assert.equal(sum(none[0].lines, 'AR', 'credit'), 300)

  const re = buildSalesReturn({ ...base, items: [{ quantity: 3, restocked: true, batchPurchasePrice: 60 }, { quantity: 1, restocked: false, batchPurchasePrice: 50 }] })
  assert.equal(re.length, 2)
  re.forEach((e) => assertBalanced(e.lines))
  const all = re.flatMap((e) => e.lines)
  assert.equal(sum(all, 'INVENTORY', 'debit'), 180)
  assert.equal(sum(all, 'COGS', 'credit'), 180)
  assert.equal(sum(all, 'SALES_RETURNS', 'debit'), 300)
})

test('purchase invoice with ST, both AIT and bonus ties to totalAmount', () => {
  // items: lineTotal 900+450, ST 20+0, AITc 15, AITp 25 => total 1350+20-15+25 = 1380
  const r = buildPurchaseInvoice({
    invoiceNumber: 'SP-PUR-1', invoiceDate: D, supplierId: 's1', totalAmount: 1380,
    items: [
      { lineTotal: 900, salesTaxAmount: 20, aitCollectibleAmount: 15, aitPayableAmount: 10 },
      { lineTotal: 450, salesTaxAmount: 0, aitCollectibleAmount: 0, aitPayableAmount: 15 },
    ],
  })
  assert.equal(r.length, 1)
  assertBalanced(r[0].lines)
  const l = r[0].lines
  assert.equal(sum(l, 'INVENTORY', 'debit'), 1350)
  assert.equal(sum(l, 'SALES_TAX_INPUT', 'debit'), 20)
  assert.equal(sum(l, 'ADV_TAX_RECOVERABLE', 'debit'), 25)
  assert.equal(sum(l, 'ADV_TAX_COLLECTED', 'credit'), 15)
  assert.equal(sum(l, 'AP', 'credit'), 1380)
  assert.equal(l.find((x) => x.accountKey === 'AP')!.supplierId, 's1')
})

test('purchase invoice rounding drift absorbed by inventory', () => {
  const r = buildPurchaseInvoice({ invoiceNumber: 'P', invoiceDate: D, supplierId: 's1', totalAmount: 100.01, items: [{ lineTotal: 100, salesTaxAmount: 0, aitCollectibleAmount: 0, aitPayableAmount: 0 }] })
  assertBalanced(r[0].lines)
  assert.equal(sum(r[0].lines, 'INVENTORY', 'debit'), 100.01)
})

test('supplier payment and return', () => {
  const p = buildSupplierPayment({ paymentDate: D, amount: 500, method: 'CASH', supplierId: 's1', invoiceNumber: 'SP-PUR-1' })
  assertBalanced(p[0].lines)
  assert.equal(sum(p[0].lines, 'AP', 'debit'), 500)
  assert.equal(sum(p[0].lines, 'CASH', 'credit'), 500)
  assert.equal(p[0].lines.find((x) => x.accountKey === 'AP')!.supplierId, 's1')
  const pb = buildSupplierPayment({ paymentDate: D, amount: 500, method: 'CHEQUE', supplierId: 's1' })
  assert.equal(sum(pb[0].lines, 'BANK', 'credit'), 500)

  const r = buildSupplierReturn({ returnNumber: 'SP-RET-1', returnDate: D, supplierId: 's1', totalAmount: 120 })
  assertBalanced(r[0].lines)
  assert.equal(sum(r[0].lines, 'AP', 'debit'), 120)
  assert.equal(sum(r[0].lines, 'INVENTORY', 'credit'), 120)
  assert.deepEqual(buildSupplierReturn({ returnNumber: 'x', returnDate: D, supplierId: 's1', totalAmount: 0 }), [])
})
