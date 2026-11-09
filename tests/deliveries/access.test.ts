import test from 'node:test'
import assert from 'node:assert/strict'
import { canViewOrder, canListOrders } from '../../lib/orders/access'
import { canViewDashboard, landingFor } from '../../lib/nav'

test('canListOrders: assignee-only roles cannot list orders', () => {
  for (const r of ['DRIVER', 'SALESMAN', 'SALES_REP']) assert.equal(canListOrders(r), false, r)
  for (const r of ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'ACCOUNTANT', 'WAREHOUSE']) assert.equal(canListOrders(r), true, r)
})

test('canViewOrder: DRIVER/SALESMAN/SALES_REP only their own delivery', () => {
  for (const r of ['DRIVER', 'SALESMAN', 'SALES_REP']) {
    assert.equal(canViewOrder(r, 'u1', 'u1'), true, r)
    assert.equal(canViewOrder(r, 'u1', 'u2'), false, r)
    assert.equal(canViewOrder(r, 'u1', null), false, r)
    assert.equal(canViewOrder(r, 'u1', undefined), false, r)
  }
  for (const r of ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'ACCOUNTANT']) assert.equal(canViewOrder(r, 'x', null), true, r)
})

test('dashboard access and landing derive from the nav config', () => {
  for (const r of ['ADMIN', 'MANAGER', 'TEAM_LEAD']) { assert.equal(canViewDashboard(r), true, r); assert.equal(landingFor(r), '/dashboard', r) }
  for (const r of ['DRIVER', 'SALESMAN', 'SALES_REP', 'WAREHOUSE', 'ACCOUNTANT']) assert.equal(canViewDashboard(r), false, r)
  assert.equal(landingFor('DRIVER'), '/my-deliveries')
  assert.equal(landingFor('SALES_REP'), '/retailers')
  assert.equal(landingFor('WAREHOUSE'), '/inventory')
  assert.equal(landingFor('NOBODY'), null)
})
