import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleTabs, NAV_HUBS } from '../../lib/nav'

const settings = NAV_HUBS.find((h) => h.key === 'settings')!
const labels = (role: string) => visibleTabs(settings, role).map((t) => t.label)

test('Audit Log tab is visible to ADMIN only', () => {
  assert.ok(labels('ADMIN').includes('Audit Log'))
  for (const role of ['MANAGER', 'ACCOUNTANT', 'TEAM_LEAD', 'WAREHOUSE', 'SALES_REP', 'SALESMAN', 'DRIVER']) {
    assert.ok(!labels(role).includes('Audit Log'), role)
  }
})

test('HR stays the last Settings tab for ADMIN', () => {
  const l = labels('ADMIN')
  assert.equal(l[l.length - 1], 'HR')
})
