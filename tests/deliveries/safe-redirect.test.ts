import test from 'node:test'
import assert from 'node:assert/strict'
import { safeFromPath } from '../../lib/utils/safe-redirect'

const FB = '/home'
test('accepts same-site paths', () => {
  assert.equal(safeFromPath('/orders', FB), '/orders')
  assert.equal(safeFromPath('/orders?x=1#y', FB), '/orders?x=1#y')
  assert.equal(safeFromPath('/%2F/evil.com', FB), '/%2F/evil.com')
})
test('rejects off-site and malformed values', () => {
  for (const bad of ['//evil.com', '/' + String.fromCharCode(92) + 'evil.com', '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\u0000/x', 'https://evil.com', 'javascript:alert(1)', 'orders', '', null]) {
    assert.equal(safeFromPath(bad, FB), FB, JSON.stringify(bad))
  }
  // what searchParams produces for %09
  assert.equal(safeFromPath(new URLSearchParams('from=/%09/evil.com').get('from'), FB), FB)
})

test('dot-segment normalisation cannot produce a protocol-relative result', () => {
  for (const bad of ['/..//evil.com', '/.//evil.com', '/a/..//evil.com', '/%2e%2e//evil.com', '/.///evil.com', '/%2E%2E//evil.com', '/a/%2e%2e//evil.com']) {
    assert.equal(safeFromPath(bad, FB), FB, bad)
  }
})

test('legit paths still pass', () => {
  assert.equal(safeFromPath('/orders/abc?x=1#y', FB), '/orders/abc?x=1#y')
  assert.equal(safeFromPath('/orders', FB), '/orders')
})

test('property: output never starts with // and never contains a backslash', () => {
  const bs = String.fromCharCode(92)
  const inputs = ['/orders', '//evil.com', '/' + bs + 'evil.com', '/\t/evil.com', '/..//evil.com', '/.//evil.com', '/a/..//evil.com', '/%2e%2e//evil.com',
    '/.///evil.com', '/%2E%2E//evil.com', '/a/%2e%2e//evil.com', '/%2F/evil.com', 'https://evil.com', 'javascript:alert(1)', '', null, '/a?b=//c#//d', '/x/../y']
  for (const i of inputs) {
    const out = safeFromPath(i, FB)
    assert.ok(!out.startsWith('//'), String(i))
    assert.ok(!out.includes(bs), String(i))
  }
})
