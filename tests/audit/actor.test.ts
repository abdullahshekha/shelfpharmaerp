import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeActor, decodeActor, actorFromStaffSession, buildForwardHeaders, ACTOR_HEADER, getCurrentActor } from '../../lib/audit/actor'

const SYSTEM = { type: 'SYSTEM', id: null, name: 'script', role: null }

test('encode/decode round-trip', () => {
  const a = { type: 'EMPLOYEE' as const, id: 'e1', name: 'Ali Ünï', role: 'MANAGER' }
  assert.deepEqual(decodeActor(encodeActor(a)), a)
})
test('invalid/missing decode to SYSTEM', () => {
  assert.deepEqual(decodeActor('garbage'), SYSTEM)
  assert.deepEqual(decodeActor(null), SYSTEM)
  assert.deepEqual(decodeActor(undefined), SYSTEM)
  assert.deepEqual(decodeActor(encodeActor({ type: 'BOGUS' } as any)), SYSTEM)
})
test('env-admin maps to null id', () => {
  const a = actorFromStaffSession({ id: 'env-admin', name: 'Admin', role: 'ADMIN' })
  assert.equal(a.id, null)
  assert.equal(a.name, 'admin (env)')
  assert.equal(a.role, 'ADMIN')
})
test('forged x-sp-actor is dropped or overwritten', () => {
  const forged = encodeActor({ type: 'EMPLOYEE', id: 'evil', name: 'Evil', role: 'ADMIN' })
  const inH = new Headers({ [ACTOR_HEADER]: forged, 'x-other': '1' })
  const none = buildForwardHeaders(inH, null)
  assert.equal(none.get(ACTOR_HEADER), null)
  assert.equal(none.get('x-other'), '1')
  const real = actorFromStaffSession({ id: 'e2', name: 'Real', role: 'MANAGER' })
  const set = buildForwardHeaders(inH, real)
  assert.deepEqual(decodeActor(set.get(ACTOR_HEADER)), real)
  assert.equal(inH.get(ACTOR_HEADER), forged) // input not mutated
})
test('getCurrentActor outside a request is SYSTEM', () => {
  assert.deepEqual(getCurrentActor(), SYSTEM)
})
