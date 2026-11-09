import test from 'node:test'
import assert from 'node:assert/strict'
import { statusRouteRoleError } from '../../lib/orders/status'
import { orderEditBlock } from '../../lib/deliveries/acknowledge-rules'
import { hasUndeductedLines, UNDEDUCTED_OUTCOME_MESSAGE } from '../../lib/deliveries/outcome-rules'
import { cardActions } from '../../lib/deliveries/ui-helpers'

const ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'TEAM_LEAD', 'SALES_REP', 'SALESMAN', 'DRIVER', 'WAREHOUSE', '', 'UNKNOWN']

test('status route: CANCELLED is ADMIN only, INVOICED ADMIN/MANAGER', () => {
  for (const r of ROLES) {
    assert.equal(statusRouteRoleError('CANCELLED', r) === null, r === 'ADMIN', `CANCELLED ${r}`)
    assert.equal(statusRouteRoleError('INVOICED', r) === null, r === 'ADMIN' || r === 'MANAGER', `INVOICED ${r}`)
  }
  assert.equal(statusRouteRoleError('CANCELLED', 'MANAGER')!.status, 403)
  assert.equal(statusRouteRoleError('CANCELLED', null)!.status, 403)
  assert.equal(statusRouteRoleError('CANCELLED', undefined)!.status, 403)
})

test('admin edit guard: refused with a current outcome, a collection or a delivery return', () => {
  assert.equal(orderEditBlock({ outcome: null, collectionCount: 0, deliveryReturnCount: 0 }), null)
  // an ON_HOLD outcome left from an earlier trip (re-assigned) is not a current outcome
  assert.equal(orderEditBlock({ outcome: 'ON_HOLD', collectionCount: 0, deliveryReturnCount: 0 }), null)
  for (const o of ['PAID_FULL', 'PAID_WITH_RETURN', 'RETURNED', 'PAY_LATER']) {
    assert.match(orderEditBlock({ outcome: o, collectionCount: 0, deliveryReturnCount: 0 }) ?? '', /outcome/i, o)
  }
  assert.match(orderEditBlock({ outcome: null, collectionCount: 1, deliveryReturnCount: 0 }) ?? '', /collection/i)
  assert.match(orderEditBlock({ outcome: null, collectionCount: 0, deliveryReturnCount: 2 }) ?? '', /return/i)
})

test('outcome guard: a line with units but null deductedQty means stock never left', () => {
  assert.equal(hasUndeductedLines([{ quantity: 2, bonusQty: 0, deductedQty: 2 }]), false)
  assert.equal(hasUndeductedLines([{ quantity: 2, bonusQty: 0, deductedQty: null }]), true)
  assert.equal(hasUndeductedLines([{ quantity: 0, bonusQty: 1, deductedQty: null }]), true)
  assert.equal(hasUndeductedLines([{ quantity: 0, bonusQty: 0, deductedQty: null }]), false) // nothing to deduct
  assert.equal(hasUndeductedLines([{ quantity: 2, bonusQty: 0, deductedQty: 0 }]), false) // fully returned line
  assert.equal(hasUndeductedLines([{ quantity: 3, bonusQty: 0, deductedQty: 3 }, { quantity: 1, bonusQty: 0, deductedQty: null }]), true)
  assert.equal(hasUndeductedLines([]), false)
  assert.match(UNDEDUCTED_OUTCOME_MESSAGE, /un-assign and assign it again/)
})

test('cardActions: no outcome action on a card whose stock never left', () => {
  assert.deepEqual(cardActions('ADMIN', 'm1', { driverId: 'u1', stockOut: false }, 'ASSIGNED'), ['reassign', 'unassign'])
  assert.deepEqual(cardActions('DRIVER', 'u1', { driverId: 'u1', stockOut: false }, 'ASSIGNED'), [])
  assert.deepEqual(cardActions('DRIVER', 'u1', { driverId: 'u1', stockOut: true }, 'ASSIGNED'), ['outcome'])
  assert.deepEqual(cardActions('DRIVER', 'u1', { driverId: 'u1' }, 'ASSIGNED'), ['outcome'])
})
