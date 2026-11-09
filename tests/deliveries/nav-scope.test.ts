import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleHubs, visibleTabs, NAV_HUBS } from '../../lib/nav'
import { deliveryScope } from '../../lib/deliveries/assign-rules'

const sales = NAV_HUBS.find((h) => h.key === 'sales')!
const salesTabs = (role: string) => visibleTabs(sales, role).map((t) => t.href)

test('assignee roles: My Deliveries on top of existing access, no extra tabs', () => {
  assert.deepEqual(salesTabs('DRIVER'), ['/my-deliveries'])
  assert.deepEqual(visibleHubs('DRIVER').map((h) => [h.key, h.target]), [['sales', '/my-deliveries']])
  assert.deepEqual(salesTabs('SALES_REP'), ['/retailers', '/my-deliveries'])
  assert.equal(visibleHubs('SALES_REP').find((h) => h.key === 'sales')!.target, '/retailers')
  assert.deepEqual(salesTabs('SALESMAN'), ['/deliveries', '/my-deliveries'])
  assert.equal(visibleHubs('SALESMAN').find((h) => h.key === 'sales')!.target, '/deliveries')
  assert.deepEqual(salesTabs('TEAM_LEAD'), ['/orders', '/invoices', '/retailers', '/my-deliveries'])
  assert.equal(visibleHubs('TEAM_LEAD').find((h) => h.key === 'sales')!.target, '/orders')
})

test('board tab stays ADMIN/MANAGER/SALESMAN; My Deliveries not for managers', () => {
  for (const r of ['DRIVER', 'SALES_REP', 'TEAM_LEAD']) assert.ok(!salesTabs(r).includes('/deliveries'), r)
  for (const r of ['ADMIN', 'MANAGER']) { assert.ok(salesTabs(r).includes('/deliveries')); assert.ok(!salesTabs(r).includes('/my-deliveries')) }
})

test('deliveryScope: managers unrestricted, everyone else only their own', () => {
  assert.deepEqual(deliveryScope({ id: 'a', role: 'ADMIN' }), {})
  assert.deepEqual(deliveryScope({ id: 'm', role: 'MANAGER' }), {})
  for (const role of ['DRIVER', 'SALESMAN', 'SALES_REP', 'TEAM_LEAD', 'ACCOUNTANT', 'WAREHOUSE']) {
    assert.deepEqual(deliveryScope({ id: 'u1', role }), { driverId: 'u1' })
  }
  assert.notDeepEqual(deliveryScope({ id: '', role: 'DRIVER' }), {})
})

test('Acknowledgements tab: ADMIN/MANAGER only, right after Deliveries', () => {
  for (const r of ['ADMIN', 'MANAGER']) {
    const t = salesTabs(r)
    assert.equal(t[t.indexOf('/deliveries') + 1], '/deliveries/acknowledgements', r)
  }
  for (const r of ['DRIVER', 'SALESMAN', 'SALES_REP', 'TEAM_LEAD', 'ACCOUNTANT', 'WAREHOUSE']) {
    assert.ok(!salesTabs(r).includes('/deliveries/acknowledgements'), r)
  }
})
