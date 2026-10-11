import test from 'node:test'
import { createHmac } from 'crypto'
import assert from 'node:assert/strict'
import {
  hashPortalPassword, verifyPortalPassword, createPortalSession, decodePortalSession,
  validatePortalUsername, validatePortalPassword,
} from '../../lib/utils/portal-auth'

test('password hash round-trips and is salted', () => {
  const a = hashPortalPassword('correct horse')
  const b = hashPortalPassword('correct horse')
  assert.notEqual(a, b)
  assert.ok(verifyPortalPassword('correct horse', a))
  assert.ok(verifyPortalPassword('correct horse', b))
  assert.ok(!verifyPortalPassword('wrong horse', a))
})

test('malformed stored hashes never verify', () => {
  for (const bad of ['', 'garbage', ':', 'zz:zz', 'abcd:']) {
    assert.equal(verifyPortalPassword('x', bad), false)
  }
})

test('session round-trips', () => {
  const token = createPortalSession({ rid: 'r1', v: 3 }, 1_000_000)
  assert.deepEqual(decodePortalSession(token, 1_000_000 + 1000), { rid: 'r1', v: 3, iat: 1_000_000 })
})

test('tampered or foreign-signed sessions are rejected', () => {
  const token = createPortalSession({ rid: 'r1', v: 0 }, Date.now())
  const [payload, sig] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ rid: 'other', v: 0, iat: Date.now() })).toString('base64url')
  assert.equal(decodePortalSession(`${forged}.${sig}`), null)
  assert.equal(decodePortalSession(`${payload}.${sig.slice(0, -2)}xx`), null)
  assert.equal(decodePortalSession('nodot'), null)
  assert.equal(decodePortalSession(''), null)
})

test('sessions expire after 7 days', () => {
  const iat = 5_000_000
  const token = createPortalSession({ rid: 'r1', v: 0 }, iat)
  assert.ok(decodePortalSession(token, iat + 6 * 86_400_000))
  assert.equal(decodePortalSession(token, iat + 8 * 86_400_000), null)
})

test('username validation normalises and rejects bad input', () => {
  assert.equal(validatePortalUsername('  Ali.Store '), 'ali.store')
  assert.equal(validatePortalUsername('abc'), 'abc')
  assert.equal(validatePortalUsername('ab'), null)
  assert.equal(validatePortalUsername('a b c'), null)
  assert.equal(validatePortalUsername('x'.repeat(33)), null)
  assert.equal(validatePortalUsername('bad/user'), null)
  assert.equal(validatePortalUsername(undefined), null)
  assert.equal(validatePortalUsername(12345), null)
})

test('password validation: 8–200 chars string', () => {
  assert.equal(validatePortalPassword('1234567'), false)
  assert.equal(validatePortalPassword('12345678'), true)
  assert.equal(validatePortalPassword('x'.repeat(201)), false)
  assert.equal(validatePortalPassword(null), false)
  assert.equal(validatePortalPassword(12345678), false)
})

test('malformed or wrong-length stored hashes never verify', () => {
  const good = hashPortalPassword('pw-12345')
  const [salt, hash] = good.split(':')
  for (const bad of ['ab:0', 'ab:a', 'ab:abc', `${salt}:`, `${salt}:${hash.slice(0, 64)}`, `${salt}:${hash}00`, `${salt.slice(2)}:${hash}`, `${good}:extra`]) {
    assert.equal(verifyPortalPassword('x', bad), false, bad)
    assert.equal(verifyPortalPassword('', bad), false, bad)
  }
})

test('verifyPortalPassword returns false for non-string input', () => {
  const good = hashPortalPassword('pw-12345')
  for (const bad of [undefined, null, 12345678, {}]) {
    assert.equal(verifyPortalPassword(bad as unknown as string, good), false)
  }
  assert.equal(verifyPortalPassword('x', undefined as unknown as string), false)
})

test('portal tokens use a derived key, not the raw staff secret', () => {
  const rawSecret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret-2026'
  const token = createPortalSession({ rid: 'r1', v: 0 })
  const [payload, sig] = token.split('.')
  const staffSig = createHmac('sha256', rawSecret).update(payload).digest('base64url')
  assert.notEqual(sig, staffSig)
  // and a staff-style signature over a portal-shaped payload is rejected
  const forgedPayload = Buffer.from(JSON.stringify({ rid: 'r1', v: 0, iat: Date.now() })).toString('base64url')
  const forgedSig = createHmac('sha256', rawSecret).update(forgedPayload).digest('base64url')
  assert.equal(decodePortalSession(`${forgedPayload}.${forgedSig}`), null)
})

test('sessions issued in the future are rejected; non-string token is null', () => {
  const now = 10_000_000
  assert.ok(decodePortalSession(createPortalSession({ rid: 'r1', v: 0 }, now + 60_000), now))
  assert.equal(decodePortalSession(createPortalSession({ rid: 'r1', v: 0 }, now + 6 * 60_000), now), null)
  assert.equal(decodePortalSession(undefined as unknown as string), null)
})
