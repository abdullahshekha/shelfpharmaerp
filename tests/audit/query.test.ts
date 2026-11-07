import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAuditWhere } from '../../lib/audit/query'

test('empty filter -> {}', () => {
  assert.deepEqual(buildAuditWhere({}), {})
})

test('simple equality filters', () => {
  assert.deepEqual(buildAuditWhere({ actorId: 'a1', model: 'Order', action: 'UPDATE' }), { actorId: 'a1', model: 'Order', action: 'UPDATE' })
})

test('Karachi days convert to UTC bounds, to is inclusive (exclusive next-day bound)', () => {
  const w = buildAuditWhere({ from: '2026-11-07', to: '2026-11-07' }) as any
  assert.equal(w.createdAt.gte.toISOString(), '2026-11-06T19:00:00.000Z')
  assert.equal(w.createdAt.lt.toISOString(), '2026-11-07T19:00:00.000Z')
})

test('only from / only to', () => {
  const a = buildAuditWhere({ from: '2026-11-07' }) as any
  assert.equal(a.createdAt.gte.toISOString(), '2026-11-06T19:00:00.000Z')
  assert.equal(a.createdAt.lt, undefined)
  const b = buildAuditWhere({ to: '2026-11-07' }) as any
  assert.equal(b.createdAt.gte, undefined)
  assert.equal(b.createdAt.lt.toISOString(), '2026-11-07T19:00:00.000Z')
})

test('invalid days are ignored', () => {
  assert.deepEqual(buildAuditWhere({ from: 'nope', to: '2026-02-31' }), {})
})

test('recordIds -> in', () => {
  assert.deepEqual(buildAuditWhere({ recordIds: ['x', 'y'] }), { recordId: { in: ['x', 'y'] } })
})
