import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import { diffRecords, redact, toJsonSafe, isNoiseOnly } from '../../lib/audit/diff'
import { shouldAuditRow, shouldAuditModel } from '../../lib/audit/config'

const d1 = new Date('2026-01-01T00:00:00Z')
const d2 = new Date('2026-01-02T00:00:00Z')

test('update returns only changed fields, ignoring updatedAt', () => {
  assert.deepEqual(
    diffRecords('Order', { status: 'PENDING', updatedAt: d1 }, { status: 'CONFIRMED', updatedAt: d2 }),
    { status: { from: 'PENDING', to: 'CONFIRMED' } },
  )
})

test('create and delete shapes', () => {
  assert.deepEqual(diffRecords('Order', null, { a: 1 }), { a: { from: null, to: 1 } })
  assert.deepEqual(diffRecords('Order', { a: 1 }, null), { a: { from: 1, to: null } })
})

test('unchanged yields empty; decimals compared numerically', () => {
  assert.deepEqual(diffRecords('Order', { a: 1 }, { a: 1 }), {})
  assert.deepEqual(
    diffRecords('Order', { p: new Prisma.Decimal('10.50') }, { p: new Prisma.Decimal('10.5') }),
    {},
  )
})

test('redaction', () => {
  assert.equal(redact('Employee', { name: 'A', passwordHash: 'x' }).passwordHash, '[hidden]')
  const r = redact('Employee', { items: { create: [{ passwordHash: 'x' }] } }) as any
  assert.equal(r.items.create[0].passwordHash, '[hidden]')
  assert.deepEqual(
    diffRecords('Employee', { passwordHash: 'a' }, { passwordHash: 'b' }),
    { passwordHash: { from: '[hidden]', to: '[hidden]' } },
  )
})

test('toJsonSafe', () => {
  assert.equal(toJsonSafe(BigInt(10)), '10')
  assert.doesNotThrow(() =>
    JSON.stringify(toJsonSafe({ a: new Prisma.Decimal('1.5'), b: d1, c: BigInt(5), d: [d2] })),
  )
})

test('isNoiseOnly', () => {
  assert.equal(isNoiseOnly('Retailer', { portalFailedAttempts: { from: 0, to: 1 } }), true)
  assert.equal(
    isNoiseOnly('Retailer', { portalFailedAttempts: { from: 0, to: 1 }, name: { from: 'a', to: 'b' } }),
    false,
  )
})

test('shouldAudit', () => {
  assert.equal(shouldAuditRow('JournalEntry', { isManual: false }), false)
  assert.equal(shouldAuditRow('JournalEntry', { isManual: true }), true)
  assert.equal(shouldAuditModel('JournalLine'), false)
  assert.equal(shouldAuditModel('Order'), true)
})
