import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canRecordOutcome,
  buildSalesReturnLines,
  invoiceTotalPaisa,
  amountDueFromStored,
  outcomeOrderStatus,
  OutcomeError,
} from '../../lib/deliveries/outcome-rules'
import { deliveryErrorBody } from '../../lib/deliveries/http'
import { AssignError } from '../../lib/deliveries/assign-rules'
import { AccountingError } from '../../lib/accounting/core'
import { ChequeError } from '../../lib/pdc/create'

// ---- canRecordOutcome ----

test('canRecordOutcome matrix', () => {
  const d = { driverId: 'drv1' }
  assert.equal(canRecordOutcome({ id: 'm1', role: 'MANAGER' }, d), true)
  assert.equal(canRecordOutcome({ id: 'env-admin', role: 'ADMIN' }, d), true)
  assert.equal(canRecordOutcome({ id: 'm1', role: 'MANAGER' }, { driverId: null }), true)
  // the assignee (any assignee role)
  assert.equal(canRecordOutcome({ id: 'drv1', role: 'DRIVER' }, d), true)
  assert.equal(canRecordOutcome({ id: 'drv1', role: 'SALES_REP' }, d), true)
  // another assignee
  assert.equal(canRecordOutcome({ id: 'drv2', role: 'DRIVER' }, d), false)
  assert.equal(canRecordOutcome({ id: 'drv2', role: 'SALESMAN' }, d), false)
  // accountant / team lead not assigned
  assert.equal(canRecordOutcome({ id: 'acc', role: 'ACCOUNTANT' }, d), false)
  assert.equal(canRecordOutcome({ id: 'tl', role: 'TEAM_LEAD' }, d), false)
  // unassigned delivery: only managers
  assert.equal(canRecordOutcome({ id: 'drv1', role: 'DRIVER' }, { driverId: null }), false)
  // no session (getUserFromRequest fallback)
  assert.equal(canRecordOutcome({ id: '', role: 'UNKNOWN' }, d), false)
  assert.equal(canRecordOutcome({ id: '', role: 'UNKNOWN' }, { driverId: null }), false)
  assert.equal(canRecordOutcome({ id: '', role: 'ADMIN' }, d), false)
  // empty id must not match an unassigned (null) or empty driver
  assert.equal(canRecordOutcome({ id: '', role: 'DRIVER' }, { driverId: '' }), false)
})

// ---- buildSalesReturnLines: the Task 1 worked example ----
// a: 10 x 100 @10% => lineTotal 900, tax 50. b: 4 x 50 => 200. c: 3 x 33.33 @10% => 89.99. Order discount 20.
// Invoice total = 1219.99
const order = {
  items: [
    { id: 'a', medicineId: 'ma', quantity: 10, bonusQty: 2, deductedQty: 12, lineTotal: 900, salesTaxAmount: 50 },
    { id: 'b', medicineId: 'mb', quantity: 4, bonusQty: 0, deductedQty: 4, lineTotal: 200, salesTaxAmount: 0 },
    { id: 'c', medicineId: 'mc', quantity: 3, bonusQty: 0, deductedQty: 3, lineTotal: 89.99, salesTaxAmount: 0 },
  ],
  discountAmount: 20,
}

test('partial return: tax-inclusive credit, order discount not credited back', () => {
  const r = buildSalesReturnLines(order, [{ orderItemId: 'a', quantity: 3, reason: 'late' }])
  assert.equal(r.totalPaisa, 28500)
  assert.equal(r.lines.length, 1)
  const l = r.lines[0]
  assert.equal(l.orderItemId, 'a')
  assert.equal(l.medicineId, 'ma')
  assert.equal(l.quantity, 3) // partial: only the paid units come back
  assert.equal(l.lineTotal, 285)
  assert.equal(l.unitPrice, 95) // effective price per unit incl. tax
  assert.equal(l.reason, 'late')
  // matches the validateOutcomeInput amount due: 1219.99 - 285 = 934.99
  assert.equal(invoiceTotalPaisa(order) - r.totalPaisa, 93499)
})

test('partial return rounds in paisa; full line credits the stored total exactly', () => {
  const p = buildSalesReturnLines(order, [{ orderItemId: 'c', quantity: 1 }])
  assert.equal(p.totalPaisa, 3000)
  assert.equal(p.lines[0].lineTotal, 30)
  assert.equal(p.lines[0].reason, null)
  const f = buildSalesReturnLines(order, [{ orderItemId: 'c', quantity: 3 }])
  assert.equal(f.totalPaisa, 8999)
  assert.equal(f.lines[0].lineTotal, 89.99)
  assert.equal(f.lines[0].unitPrice, 30) // round(8999/3) = 3000 paisa
})

test('full line return brings back the shipped bonus units too', () => {
  const r = buildSalesReturnLines(order, [{ orderItemId: 'a', quantity: 10 }, { orderItemId: 'b', quantity: 1 }])
  assert.equal(r.lines[0].quantity, 12) // deductedQty (10 + 2 bonus)
  assert.equal(r.lines[0].lineTotal, 950)
  assert.equal(r.lines[1].quantity, 1)
  assert.equal(r.lines[1].lineTotal, 50)
  assert.equal(r.totalPaisa, 100000)
})

test('whole order returned: credit equals the invoice total (discount allocated, paisa exact)', () => {
  const all = order.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity, reason: 'wrong order' }))
  const r = buildSalesReturnLines(order, all)
  assert.equal(r.totalPaisa, 121999)
  assert.equal(r.lines.reduce((s, l) => s + Math.round(l.lineTotal * 100), 0), 121999)
  // discount 2000 paisa split by credit (95000 / 20000 / 8999 of 123999): 1532 / 323 / 145 (largest remainder)
  assert.deepEqual(r.lines.map((l) => Math.round(l.lineTotal * 100)), [95000 - 1532, 20000 - 323, 8999 - 145])
  assert.ok(r.lines.every((l) => l.reason === 'wrong order'))
})

test('whole order with a bonus-only line returns its units at zero credit', () => {
  const o = {
    items: [
      { id: 'x', medicineId: 'mx', quantity: 2, bonusQty: 0, deductedQty: 2, lineTotal: 100, salesTaxAmount: 0 },
      { id: 'y', medicineId: 'my', quantity: 0, bonusQty: 1, deductedQty: 1, lineTotal: 0, salesTaxAmount: 0 },
    ],
  }
  const r = buildSalesReturnLines(o, [{ orderItemId: 'x', quantity: 2 }, { orderItemId: 'y', quantity: 0 }])
  assert.equal(r.totalPaisa, 10000)
  assert.deepEqual(r.lines.map((l) => [l.orderItemId, l.quantity, l.lineTotal, l.unitPrice]), [['x', 2, 100, 50], ['y', 1, 0, 0]])
})

test('null deductedQty (nothing recorded) falls back to quantity + bonus on a full line', () => {
  const o = { items: [{ id: 'z', medicineId: 'mz', quantity: 5, bonusQty: 1, deductedQty: null, lineTotal: 50, salesTaxAmount: 5 }] }
  const r = buildSalesReturnLines(o, [{ orderItemId: 'z', quantity: 5 }])
  assert.equal(r.lines[0].quantity, 6)
  assert.equal(r.totalPaisa, 5500)
})

test('unknown line throws', () => {
  assert.throws(() => buildSalesReturnLines(order, [{ orderItemId: 'nope', quantity: 1 }]), /belong/)
})

// ---- amount due from the stored invoice ----

test('amountDueFromStored: stored invoice total, less payments already made and the return credit, floored at 0', () => {
  assert.equal(amountDueFromStored({ invoiceTotal: 1219.99, paid: 0, creditPaisa: 0 }), 121999)
  assert.equal(amountDueFromStored({ invoiceTotal: 1219.99, paid: 0, creditPaisa: 28500 }), 93499)
  assert.equal(amountDueFromStored({ invoiceTotal: 1219.99, paid: 200, creditPaisa: 28500 }), 73499)
  assert.equal(amountDueFromStored({ invoiceTotal: 100, paid: 150, creditPaisa: 0 }), 0)
})

test('outcomeOrderStatus maps outcomes to order statuses', () => {
  assert.equal(outcomeOrderStatus('PAID_FULL'), 'DELIVERED')
  assert.equal(outcomeOrderStatus('PAID_WITH_RETURN'), 'DELIVERED')
  assert.equal(outcomeOrderStatus('PAY_LATER'), 'DELIVERED')
  assert.equal(outcomeOrderStatus('RETURNED'), 'RETURNED')
  assert.equal(outcomeOrderStatus('ON_HOLD'), 'ON_HOLD')
})

// ---- route error mapping ----

test('deliveryErrorBody maps domain errors, retries and busy', () => {
  assert.deepEqual(deliveryErrorBody(new OutcomeError(409, 'x')), { status: 409, body: { error: 'x' } })
  assert.deepEqual(deliveryErrorBody(new AssignError(403, 'no')), { status: 403, body: { error: 'no' } })
  assert.deepEqual(deliveryErrorBody(new AccountingError(409, 'locked')), { status: 409, body: { error: 'locked' } })
  assert.deepEqual(deliveryErrorBody(new ChequeError(409, 'dup', { duplicate: true, existingId: 'c1' })), {
    status: 409, body: { error: 'dup', duplicate: true, existingId: 'c1' },
  })
  assert.equal(deliveryErrorBody({ code: 'P2034', message: 'write conflict' })?.status, 409)
  assert.equal(deliveryErrorBody({ code: 'P2010', message: 'Raw query failed', meta: { code: '40P01' } })?.status, 409)
  assert.equal(deliveryErrorBody({ code: 'P2010', message: 'ERROR: deadlock detected' })?.status, 409)
  assert.equal(deliveryErrorBody({ code: 'P2028', message: 'Transaction API error' })?.status, 503)
  assert.equal(deliveryErrorBody({ code: 'P2002', message: 'Unique constraint' })?.status, 409)
  assert.equal(deliveryErrorBody(new Error('boom')), null)
})
