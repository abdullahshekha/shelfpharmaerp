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
