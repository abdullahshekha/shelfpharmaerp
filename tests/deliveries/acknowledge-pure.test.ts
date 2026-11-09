import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AckError,
  canAcknowledge,
  unpaidAfterPaymentsPaisa,
  collectionAmountError,
  invoiceStatusFromPaisa,
  collectionPaymentMethod,
  planReturnRestock,
  orderReturnBlock,
  acknowledgedCollectionDeleteBlock,
  ORDER_RETURN_BLOCK_MESSAGE,
  ACK_COLLECTION_DELETE_MESSAGE,
} from '../../lib/deliveries/acknowledge-rules'
import { deliveryErrorBody } from '../../lib/deliveries/http'

// ---- canAcknowledge ----

test('canAcknowledge: ADMIN/MANAGER only', () => {
  assert.equal(canAcknowledge('ADMIN'), true)
  assert.equal(canAcknowledge('MANAGER'), true)
  for (const r of ['ACCOUNTANT', 'DRIVER', 'SALESMAN', 'SALES_REP', 'TEAM_LEAD', 'WAREHOUSE', 'UNKNOWN', '', null, undefined]) {
    assert.equal(canAcknowledge(r as string), false, String(r))
  }
})

// ---- unpaidAfterPaymentsPaisa ----

test('unpaidAfterPaymentsPaisa: no payments = whole total', () => {
  assert.equal(unpaidAfterPaymentsPaisa(123456, []), 123456)
})

test('unpaidAfterPaymentsPaisa: partial payments', () => {
  assert.equal(unpaidAfterPaymentsPaisa(100000, [25000, 30001]), 44999)
})

test('unpaidAfterPaymentsPaisa: exact settle = 0', () => {
  assert.equal(unpaidAfterPaymentsPaisa(33333, [11111, 11111, 11111]), 0)
})

test('unpaidAfterPaymentsPaisa: overpaid never negative', () => {
  assert.equal(unpaidAfterPaymentsPaisa(1000, [600, 600]), 0)
})

test('unpaidAfterPaymentsPaisa: float noise in paisa inputs is rounded', () => {
  // 0.1 + 0.2 rupees style noise expressed in paisa
  assert.equal(unpaidAfterPaymentsPaisa(100010.00000001, [10.000000002, 99999.9999999]), 0)
  assert.equal(unpaidAfterPaymentsPaisa(100011.0000001, [10.000000002, 99999.9999999]), 1)
  assert.equal(unpaidAfterPaymentsPaisa(30, [10.0000001, 19.9999999]), 0)
})

test('unpaidAfterPaymentsPaisa: invalid input throws', () => {
  assert.throws(() => unpaidAfterPaymentsPaisa(Number.NaN, []))
  assert.throws(() => unpaidAfterPaymentsPaisa(100, [Number.POSITIVE_INFINITY]))
})

// ---- collectionAmountError ----

test('collectionAmountError: exact settle accepted', () => {
  assert.equal(collectionAmountError(44999, 44999), null)
})

test('collectionAmountError: less than unpaid accepted', () => {
  assert.equal(collectionAmountError(100, 44999), null)
})

test('collectionAmountError: over-amount refused (one paisa)', () => {
  assert.match(collectionAmountError(45000, 44999) ?? '', /exceeds/i)
})

test('collectionAmountError: nothing unpaid refused', () => {
  assert.match(collectionAmountError(1, 0) ?? '', /exceeds/i)
})

test('collectionAmountError: zero/negative amount refused', () => {
  assert.notEqual(collectionAmountError(0, 100), null)
  assert.notEqual(collectionAmountError(-5, 100), null)
})

// ---- invoiceStatusFromPaisa (same rule as the payment routes) ----

test('invoiceStatusFromPaisa', () => {
  assert.equal(invoiceStatusFromPaisa(1000, 1000), 'PAID')
  assert.equal(invoiceStatusFromPaisa(1000, 1001), 'PAID')
  assert.equal(invoiceStatusFromPaisa(1000, 999), 'PARTIAL')
  assert.equal(invoiceStatusFromPaisa(1000, 0), 'UNPAID')
})

// ---- collectionPaymentMethod ----

test('collectionPaymentMethod maps CASH/BANK to Payment methods', () => {
  assert.equal(collectionPaymentMethod('CASH'), 'CASH')
  assert.equal(collectionPaymentMethod('BANK'), 'BANK_TRANSFER')
  assert.throws(() => collectionPaymentMethod('CHEQUE'))
})

// ---- planReturnRestock ----

test('planReturnRestock: one line per medicine, whole return', () => {
  const plan = planReturnRestock(
    [
      { id: 'b', medicineId: 'm2', out: 5 },
      { id: 'a', medicineId: 'm1', out: 12 },
    ],
    [
      { id: 'r1', medicineId: 'm1', quantity: 12 },
      { id: 'r2', medicineId: 'm2', quantity: 5 },
    ],
  )
  assert.deepEqual(plan.items, [
    { id: 'r1', medicineId: 'm1', restockQty: 12, excess: 0 },
    { id: 'r2', medicineId: 'm2', restockQty: 5, excess: 0 },
  ])
  assert.deepEqual(Array.from(plan.newDeducted.entries()).sort(), [['a', 0], ['b', 0]])
})

test('planReturnRestock: partial return reduces deductedQty, never below 0', () => {
  const plan = planReturnRestock([{ id: 'a', medicineId: 'm1', out: 10 }], [{ id: 'r1', medicineId: 'm1', quantity: 3 }])
  assert.equal(plan.newDeducted.get('a'), 7)
  assert.equal(plan.items[0].restockQty, 3)
})

test('planReturnRestock: several lines of one medicine consumed in line-id order', () => {
  const plan = planReturnRestock(
    [
      { id: 'l2', medicineId: 'm1', out: 4 },
      { id: 'l1', medicineId: 'm1', out: 3 },
      { id: 'l3', medicineId: 'm1', out: 6 },
    ],
    [{ id: 'r1', medicineId: 'm1', quantity: 8 }],
  )
  // l1 (3) then l2 (4) then 1 from l3
  assert.equal(plan.newDeducted.get('l1'), 0)
  assert.equal(plan.newDeducted.get('l2'), 0)
  assert.equal(plan.newDeducted.get('l3'), 5)
  assert.deepEqual(plan.items, [{ id: 'r1', medicineId: 'm1', restockQty: 8, excess: 0 }])
})

test('planReturnRestock: two return items of the same medicine share the lines', () => {
  const plan = planReturnRestock(
    [
      { id: 'l1', medicineId: 'm1', out: 5 },
      { id: 'l2', medicineId: 'm1', out: 5 },
    ],
    [
      { id: 'r1', medicineId: 'm1', quantity: 5 },
      { id: 'r2', medicineId: 'm1', quantity: 5 },
    ],
  )
  assert.equal(plan.newDeducted.get('l1'), 0)
  assert.equal(plan.newDeducted.get('l2'), 0)
  assert.deepEqual(plan.items.map((i) => i.restockQty), [5, 5])
})

test('planReturnRestock: more returned than recorded out is capped, excess reported', () => {
  const plan = planReturnRestock([{ id: 'a', medicineId: 'm1', out: 2 }], [{ id: 'r1', medicineId: 'm1', quantity: 5 }])
  assert.deepEqual(plan.items, [{ id: 'r1', medicineId: 'm1', restockQty: 2, excess: 3 }])
  assert.equal(plan.newDeducted.get('a'), 0)
})

test('planReturnRestock: medicine not on the order -> nothing restocked, all excess', () => {
  const plan = planReturnRestock([{ id: 'a', medicineId: 'm1', out: 2 }], [{ id: 'r1', medicineId: 'mX', quantity: 4 }])
  assert.deepEqual(plan.items, [{ id: 'r1', medicineId: 'mX', restockQty: 0, excess: 4 }])
  assert.equal(plan.newDeducted.has('a'), false) // untouched line not in the update map
})

test('planReturnRestock: lines untouched by the return are not in newDeducted', () => {
  const plan = planReturnRestock(
    [
      { id: 'a', medicineId: 'm1', out: 10 },
      { id: 'b', medicineId: 'm2', out: 10 },
    ],
    [{ id: 'r1', medicineId: 'm1', quantity: 1 }],
  )
  assert.deepEqual(Array.from(plan.newDeducted.entries()), [['a', 9]])
})

test('planReturnRestock: return items are processed in id order (deterministic)', () => {
  const plan = planReturnRestock(
    [{ id: 'a', medicineId: 'm1', out: 3 }],
    [
      { id: 'r2', medicineId: 'm1', quantity: 2 },
      { id: 'r1', medicineId: 'm1', quantity: 2 },
    ],
  )
  assert.deepEqual(plan.items, [
    { id: 'r1', medicineId: 'm1', restockQty: 2, excess: 0 },
    { id: 'r2', medicineId: 'm1', restockQty: 1, excess: 1 },
  ])
})

// ---- delete / cancel guards ----

test('orderReturnBlock', () => {
  assert.equal(orderReturnBlock(0), null)
  assert.equal(orderReturnBlock(1), ORDER_RETURN_BLOCK_MESSAGE)
  assert.equal(ORDER_RETURN_BLOCK_MESSAGE, 'Order has a return; cannot cancel/delete')
})

test('acknowledgedCollectionDeleteBlock', () => {
  assert.equal(acknowledgedCollectionDeleteBlock([]), null)
  assert.equal(acknowledgedCollectionDeleteBlock([{ acknowledgedAt: null }]), null)
  assert.equal(acknowledgedCollectionDeleteBlock([{ acknowledgedAt: null }, { acknowledgedAt: new Date() }]), ACK_COLLECTION_DELETE_MESSAGE)
  assert.equal(ACK_COLLECTION_DELETE_MESSAGE, 'Paid by acknowledged collection; cannot delete.')
})

// ---- error mapping ----

test('deliveryErrorBody maps AckError', () => {
  assert.deepEqual(deliveryErrorBody(new AckError(409, 'Already acknowledged')), { status: 409, body: { error: 'Already acknowledged' } })
  assert.deepEqual(deliveryErrorBody(new AckError(403, 'Forbidden')), { status: 403, body: { error: 'Forbidden' } })
})
