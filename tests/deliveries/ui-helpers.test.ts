import test from 'node:test'
import assert from 'node:assert/strict'
import { cardActions } from '../../lib/deliveries/ui-helpers'

const COLS = ['READY', 'ASSIGNED', 'DELIVERED', 'RETURNED', 'ON_HOLD'] as const
const mine = { driverId: 'u1' }
const other = { driverId: 'u2' }
const none = { driverId: null }

test('manager and admin: assign from Ready, reassign/unassign/outcome on Assigned, nothing else', () => {
  for (const role of ['ADMIN', 'MANAGER']) {
    assert.deepEqual(cardActions(role, 'm1', none, 'READY'), ['assign'])
    assert.deepEqual(cardActions(role, 'm1', other, 'READY'), ['assign']) // held order being re-assigned
    assert.deepEqual(cardActions(role, 'm1', other, 'ASSIGNED'), ['reassign', 'unassign', 'outcome'])
    for (const c of ['DELIVERED', 'RETURNED', 'ON_HOLD'] as const) assert.deepEqual(cardActions(role, 'm1', other, c), [])
  }
})

test('assignee: outcome only on their own Assigned delivery', () => {
  for (const role of ['DRIVER', 'SALESMAN', 'SALES_REP', 'TEAM_LEAD']) {
    assert.deepEqual(cardActions(role, 'u1', mine, 'ASSIGNED'), ['outcome'])
    assert.deepEqual(cardActions(role, 'u1', other, 'ASSIGNED'), [])
    assert.deepEqual(cardActions(role, 'u1', none, 'ASSIGNED'), [])
    for (const c of COLS.filter((x) => x !== 'ASSIGNED')) assert.deepEqual(cardActions(role, 'u1', mine, c), [])
  }
})

test('other roles and missing user get nothing', () => {
  for (const role of ['ACCOUNTANT', 'WAREHOUSE', '']) for (const c of COLS) assert.deepEqual(cardActions(role, 'u1', mine, c), [])
  for (const c of COLS) assert.deepEqual(cardActions('DRIVER', '', { driverId: '' }, c), [])
})
