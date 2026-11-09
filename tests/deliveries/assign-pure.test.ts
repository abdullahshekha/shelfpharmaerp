import test from 'node:test'
import assert from 'node:assert/strict'
import {
  linesToDeduct,
  canAssign,
  canManageAssignments,
  isValidAssignee,
  unitsByMedicine,
  stillDeductedQty,
  AssignError,
  hasCurrentOutcome,
} from '../../lib/deliveries/assign-rules'
import { shouldSkipDeliverySync } from '../../lib/deliveries/test-switch'

test('linesToDeduct keeps only lines with null/0 deductedQty, with bonus units included', () => {
  const items = [
    { id: 'a', medicineId: 'm1', quantity: 10, bonusQty: 2, deductedQty: null },
    { id: 'b', medicineId: 'm2', quantity: 5, bonusQty: 0, deductedQty: 0 },
    { id: 'c', medicineId: 'm3', quantity: 7, bonusQty: 1, deductedQty: 8 },
    { id: 'd', medicineId: 'm4', quantity: 3, deductedQty: undefined },
  ]
  const r = linesToDeduct(items)
  assert.deepEqual(r.map((l) => [l.id, l.units]), [['a', 12], ['b', 5], ['d', 3]])
})

test('linesToDeduct: re-assignment after On Hold (all lines still deducted) deducts nothing', () => {
  assert.deepEqual(linesToDeduct([
    { quantity: 10, bonusQty: 2, deductedQty: 12 },
    { quantity: 1, bonusQty: 0, deductedQty: 1 },
  ]), [])
})

test('linesToDeduct skips lines with nothing to ship', () => {
  assert.deepEqual(linesToDeduct([{ quantity: 0, bonusQty: 0, deductedQty: null }]), [])
})

test('unitsByMedicine sums lines sharing a medicine', () => {
  const m = unitsByMedicine([{ medicineId: 'x', units: 3 }, { medicineId: 'y', units: 1 }, { medicineId: 'x', units: 4 }])
  assert.equal(m.get('x'), 7)
  assert.equal(m.get('y'), 1)
})

test('canAssign: INVOICED or ON_HOLD, by ADMIN/MANAGER only', () => {
  for (const role of ['ADMIN', 'MANAGER']) {
    assert.equal(canAssign('INVOICED', role), true)
    assert.equal(canAssign('ON_HOLD', role), true)
    for (const s of ['RECEIVED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED', 'CONFIRMED']) {
      assert.equal(canAssign(s, role), false, `${s} by ${role}`)
    }
  }
  for (const role of ['ACCOUNTANT', 'TEAM_LEAD', 'SALES_REP', 'SALESMAN', 'DRIVER', 'WAREHOUSE', '', null, undefined]) {
    assert.equal(canAssign('INVOICED', role), false, String(role))
    assert.equal(canManageAssignments(role), false)
  }
})

test('isValidAssignee: active employee with an assignee role', () => {
  for (const role of ['DRIVER', 'SALESMAN', 'SALES_REP', 'TEAM_LEAD']) assert.equal(isValidAssignee({ isActive: true, role }), true)
  for (const role of ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'WAREHOUSE']) assert.equal(isValidAssignee({ isActive: true, role }), false)
  assert.equal(isValidAssignee({ isActive: false, role: 'DRIVER' }), false)
  assert.equal(isValidAssignee(null), false)
})

test('stillDeductedQty: deductedQty is the truth; null = ordered quantity only on legacy DELIVERED rows', () => {
  assert.equal(stillDeductedQty('OUT_FOR_DELIVERY', { quantity: 10, deductedQty: 12 }), 12)
  assert.equal(stillDeductedQty('ON_HOLD', { quantity: 10, deductedQty: 12 }), 12)
  assert.equal(stillDeductedQty('RETURNED', { quantity: 10, deductedQty: 0 }), 0) // return acknowledged
  assert.equal(stillDeductedQty('RETURNED', { quantity: 10, deductedQty: null }), 0)
  assert.equal(stillDeductedQty('OUT_FOR_DELIVERY', { quantity: 10, deductedQty: null }), 0) // converted, never deducted
  assert.equal(stillDeductedQty('DELIVERED', { quantity: 10, deductedQty: null }), 10) // legacy
  assert.equal(stillDeductedQty('DELIVERED', { quantity: 10, deductedQty: 4 }), 4) // partly returned
})

test('AssignError carries an HTTP status', () => {
  const e = new AssignError(409, 'Not enough stock for X')
  assert.equal(e.status, 409)
  assert.equal(e.message, 'Not enough stock for X')
  assert.ok(e instanceof Error)
})

test('DELIVERY_TEST_SKIP_SYNC is inert in production', () => {
  assert.equal(shouldSkipDeliverySync({ NODE_ENV: 'production', DELIVERY_TEST_SKIP_SYNC: '1' }), false)
  assert.equal(shouldSkipDeliverySync({ NODE_ENV: 'development', DELIVERY_TEST_SKIP_SYNC: '1' }), true)
  assert.equal(shouldSkipDeliverySync({ NODE_ENV: 'test', DELIVERY_TEST_SKIP_SYNC: '1' }), true)
  assert.equal(shouldSkipDeliverySync({ NODE_ENV: 'development' }), false)
  assert.equal(shouldSkipDeliverySync({ NODE_ENV: 'development', DELIVERY_TEST_SKIP_SYNC: 'true' }), false)
})

test('hasCurrentOutcome ignores an On Hold outcome left from an earlier trip', () => {
  assert.equal(hasCurrentOutcome(null), false)
  assert.equal(hasCurrentOutcome(undefined), false)
  assert.equal(hasCurrentOutcome('ON_HOLD'), false)
  for (const o of ['PAID_FULL', 'PAID_WITH_RETURN', 'RETURNED', 'PAY_LATER']) assert.equal(hasCurrentOutcome(o), true)
})
