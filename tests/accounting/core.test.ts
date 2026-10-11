import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toPaisa, fromPaisa, round2 } from '../../lib/accounting/money'
import { assertBalanced, assertNotLocked } from '../../lib/accounting/core'

test('toPaisa rounds to nearest paisa and survives float noise', () => {
  assert.equal(toPaisa(1.005), 101)
  assert.equal(toPaisa(0.1 + 0.2), 30)
  assert.equal(toPaisa(10), 1000)
  assert.equal(toPaisa(1.239), 124)
  assert.equal(toPaisa(0), 0)
  assert.equal(toPaisa(-2.5), -250)
})

test('fromPaisa and round2', () => {
  assert.equal(fromPaisa(12345), 123.45)
  assert.equal(round2(0.1 + 0.2), 0.3)
  assert.equal(round2(2.345), 2.35)
})

test('assertBalanced accepts balanced entry', () => {
  assertBalanced([{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 100 }])
  assertBalanced([
    { accountId: 'a', debit: 0.1 },
    { accountId: 'b', debit: 0.2 },
    { accountId: 'c', credit: 0.1 + 0.2 },
  ])
})

test('assertBalanced rejects off-by-0.01', () => {
  assert.throws(() => assertBalanced([{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 99.99 }]))
})

test('assertBalanced rejects zero total, negatives, and both-sided or empty lines', () => {
  assert.throws(() => assertBalanced([]))
  assert.throws(() => assertBalanced([{ accountId: 'a', debit: 0 }, { accountId: 'b', credit: 0 }]))
  assert.throws(() => assertBalanced([{ accountId: 'a', debit: -5 }, { accountId: 'b', credit: -5 }]))
  assert.throws(() => assertBalanced([{ accountId: 'a', debit: 5, credit: 5 }, { accountId: 'b', credit: 5 }]))
  assert.throws(() => assertBalanced([{ accountId: 'a', debit: 10 }, { accountId: 'b', credit: 10 }, { accountId: 'c' }]))
})

test('assertNotLocked', () => {
  const s = { lockedThrough: new Date('2026-09-30T00:00:00Z') }
  assert.throws(() => assertNotLocked(s, new Date('2026-09-30T00:00:00Z')))
  assert.throws(() => assertNotLocked(s, new Date('2026-09-01T00:00:00Z')))
  assertNotLocked(s, new Date('2026-10-01T00:00:00Z'))
  assertNotLocked({ lockedThrough: null }, new Date('2020-01-01'))
})
