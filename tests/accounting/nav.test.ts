import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibleHubs, visibleTabs, tabBarFor, NAV_HUBS } from '../../lib/nav'

const hubKeys = (role: string) => visibleHubs(role).map((h) => h.key)
const settings = NAV_HUBS.find((h) => h.key === 'settings')!
const accounts = NAV_HUBS.find((h) => h.key === 'accounts')!

test('ADMIN sees every hub and all settings tabs', () => {
  assert.deepEqual(hubKeys('ADMIN'), ['dashboard', 'inventory', 'sales', 'purchase', 'accounts', 'reports', 'settings'])
  assert.equal(visibleTabs(settings, 'ADMIN').length, 7)
  assert.ok(tabBarFor('/settings/areas', 'ADMIN'))
})

test('MANAGER sees an Accounts hub holding only PDC Management, and no Chart of Accounts tab', () => {
  const acc = visibleHubs('MANAGER').find((h) => h.key === 'accounts')
  assert.ok(acc)
  assert.equal(acc!.target, '/accounts/pdc')
  assert.deepEqual(visibleTabs(accounts, 'MANAGER').map((t) => t.href), ['/accounts/pdc'])
  assert.equal(tabBarFor('/accounts/pdc', 'MANAGER'), null)
  const labels = visibleTabs(settings, 'MANAGER').map((t) => t.label)
  assert.ok(!labels.includes('Chart of Accounts'))
  assert.deepEqual(labels, ['Approvals', 'Areas', 'Categories', 'Manufacturers', 'HR'])
  assert.ok(hubKeys('MANAGER').includes('settings'))
})

test('ACCOUNTANT sees Settings with only Chart of Accounts, targeting that page, no tab bar', () => {
  const hub = visibleHubs('ACCOUNTANT').find((h) => h.key === 'settings')
  assert.ok(hub)
  assert.equal(hub!.target, '/settings/chart-of-accounts')
  assert.deepEqual(visibleTabs(settings, 'ACCOUNTANT').map((t) => t.href), ['/settings/chart-of-accounts'])
  assert.equal(tabBarFor('/settings/chart-of-accounts', 'ACCOUNTANT'), null)
  assert.ok(hubKeys('ACCOUNTANT').includes('accounts'))
})

test('other roles never see accounts or settings tabs they cannot use', () => {
  for (const role of ['TEAM_LEAD', 'WAREHOUSE', 'SALES_REP', 'SALESMAN', 'DRIVER']) {
    assert.ok(!hubKeys(role).includes('accounts'), role)
    assert.deepEqual(visibleTabs(accounts, role), [], role)
    assert.ok(!hubKeys(role).includes('settings'), role)
  }
})

test('tab bar for Chart of Accounts shows it to ADMIN only among admin tabs', () => {
  const bar = tabBarFor('/settings/chart-of-accounts', 'ADMIN')
  assert.ok(bar && bar.tabs.some((t) => t.href === '/settings/chart-of-accounts'))
  const mbar = tabBarFor('/settings/areas', 'MANAGER')
  assert.ok(mbar && !mbar.tabs.some((t) => t.href === '/settings/chart-of-accounts'))
})

test('PDC Management tab: ADMIN and ACCOUNTANT see it among all accounts tabs, ADMIN still lands on General Ledgers', () => {
  for (const role of ['ADMIN', 'ACCOUNTANT']) {
    const hrefs = visibleTabs(accounts, role).map((t) => t.href)
    assert.ok(hrefs.includes('/accounts/pdc'), role)
    assert.ok(hrefs.includes('/accounts/general-ledger'), role)
    assert.equal(visibleHubs(role).find((h) => h.key === 'accounts')!.target, '/accounts/general-ledger', role)
    assert.ok(tabBarFor('/accounts/pdc', role), role)
  }
})
