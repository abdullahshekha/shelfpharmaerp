import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedUsername } from '../../lib/audit/username'

test('boundedUsername always yields a string of at most 64 chars', () => {
  assert.equal(boundedUsername('alice'), 'alice')
  assert.equal(boundedUsername('x'.repeat(500)).length, 64)
  assert.equal(boundedUsername(undefined), '')
  assert.equal(boundedUsername(null), '')
  assert.equal(typeof boundedUsername({ contains: 'a'.repeat(200) }), 'string')
  assert.ok(boundedUsername({ contains: 'a'.repeat(200) }).length <= 64)
  assert.equal(boundedUsername(12345), '12345')
})
