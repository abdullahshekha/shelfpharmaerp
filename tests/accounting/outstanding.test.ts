import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invoiceDuePaisa, outstandingRupees, dueByRetailer } from '../../lib/utils/outstanding'

test('PARTIAL invoice nets its payments (the pre-existing bug counted the gross total)', () => {
  const inv = { retailerId: 'r', status: 'PARTIAL', totalAmount: 1000, payments: [{ amount: 400 }] }
  assert.equal(invoiceDuePaisa(inv), 60000)
  assert.equal(outstandingRupees([inv]), 600)
})

test('PAID and DRAFT invoices carry no balance; OVERDUE and UNPAID count', () => {
  assert.equal(invoiceDuePaisa({ status: 'PAID', totalAmount: 500, payments: [] }), 0)
  assert.equal(invoiceDuePaisa({ status: 'DRAFT', totalAmount: 500 }), 0)
  assert.equal(invoiceDuePaisa({ status: 'OVERDUE', totalAmount: 500, payments: [{ amount: 100 }] }), 40000)
  assert.equal(invoiceDuePaisa({ status: 'UNPAID', totalAmount: 500 }), 50000)
})

test('an overpaid invoice never goes negative', () => {
  assert.equal(invoiceDuePaisa({ status: 'PARTIAL', totalAmount: 100, payments: [{ amount: 150 }] }), 0)
})

test('return credits are subtracted once; decimals and strings are handled in paisa', () => {
  const invs = [
    { status: 'UNPAID', totalAmount: '100.10', payments: [] },
    { status: 'PARTIAL', totalAmount: '200.20', payments: [{ amount: '0.20' }] },
  ]
  assert.equal(outstandingRupees(invs, 50.05), 250.05)
})

test('dueByRetailer groups per customer', () => {
  const m = dueByRetailer([
    { retailerId: 'a', status: 'UNPAID', totalAmount: 10 },
    { retailerId: 'a', status: 'PARTIAL', totalAmount: 20, payments: [{ amount: 5 }] },
    { retailerId: 'b', status: 'PAID', totalAmount: 99 },
  ])
  assert.equal(m.get('a'), 2500)
  assert.equal(m.get('b'), 0)
})

test('allowNegative keeps an overpaid open invoice as a credit (for ledger reconciliation)', () => {
  const inv = { retailerId: 'r1', status: 'PARTIAL', totalAmount: 100, payments: [{ amount: 130 }] }
  assert.equal(invoiceDuePaisa(inv), 0)
  assert.equal(invoiceDuePaisa(inv, { allowNegative: true }), -3000)
  assert.equal(dueByRetailer([inv], { allowNegative: true }).get('r1'), -3000)
})
