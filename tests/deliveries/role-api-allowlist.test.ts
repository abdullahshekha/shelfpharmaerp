import test from 'node:test'
import assert from 'node:assert/strict'
import { isApiAllowedForRole } from '../../lib/utils/role-api-allowlist'

const D = 'DRIVER'

test('non-DRIVER roles are not restricted by the allowlist', () => {
  for (const r of ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'TEAM_LEAD', 'SALES_REP', 'SALESMAN', 'WAREHOUSE']) {
    assert.equal(isApiAllowedForRole(r, 'GET', '/api/invoices'), true, r)
    assert.equal(isApiAllowedForRole(r, 'POST', '/api/orders'), true, r)
  }
})

test('DRIVER: allowed paths', () => {
  const ok: [string, string][] = [
    ['GET', '/api/deliveries'],
    ['GET', '/api/deliveries/'],
    ['POST', '/api/deliveries/upload-picture'],
    ['POST', '/api/deliveries/cmabc123/outcome'],
    ['PUT', '/api/deliveries/cmabc123'],
    ['GET', '/api/deliveries/print'],
    ['GET', '/api/cheques/banks'],
    ['GET', '/api/orders/cmabc123'],
    ['GET', '/api/notifications'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/logout'],
    ['get', '/api/deliveries'],
  ]
  for (const [m, p] of ok) assert.equal(isApiAllowedForRole(D, m, p), true, `${m} ${p}`)
})

test('DRIVER: denied paths and methods', () => {
  const bad: [string, string][] = [
    ['GET', '/api/invoices'],
    ['GET', '/api/orders'],
    ['GET', '/api/orders/'],
    ['PUT', '/api/orders/cmabc123'],
    ['DELETE', '/api/orders/cmabc123'],
    ['PUT', '/api/orders/cmabc123/status'],
    ['GET', '/api/orders/cmabc123/history'],
    ['GET', '/api/orders/cmabc123/challan'],
    ['GET', '/api/orders/a/b'],
    ['POST', '/api/cheques/banks'],
    ['GET', '/api/cheques'],
    ['POST', '/api/cheques'],
    ['PUT', '/api/notifications'],
    ['GET', '/api/notificationsX'],
    ['GET', '/api/delivery-acknowledgements'],
    ['GET', '/api/deliveriesX'],
    ['GET', '/api/deliveries-x'],
    ['GET', '/api/deliveries/../invoices'],
    ['GET', '/api/deliveries/./x'],
    ['GET', '/api/deliveries/%2e%2e/invoices'],
    ['GET', '/api/deliveries%2Fx'],
    ['GET', '/api/deliveries//x'],
    ['GET', '/api/deliveries\\x'],
    ['GET', '/api/deliveries/x\ny'],
    ['GET', '/API/deliveries'],
    ['GET', '/api/dashboard/stats'],
    ['GET', '/api/retailers'],
    ['GET', ''],
  ]
  for (const [m, p] of bad) assert.equal(isApiAllowedForRole(D, m, p), false, `${m} ${JSON.stringify(p)}`)
})
