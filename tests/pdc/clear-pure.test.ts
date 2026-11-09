import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateClearingDate, chequeAmountPaisa, PdcError } from '../../lib/pdc/clear-rules'
import { AccountingError } from '../../lib/accounting/core'

// "now" = 2026-11-09 15:00 Karachi (10:00 UTC)
const now = new Date('2026-11-09T10:00:00Z')
const k = (day: string) => new Date(`${day}T00:00:00+05:00`)
const base = {
  clearingDate: k('2026-11-09'),
  receivedDate: k('2026-11-01'),
  goLiveDate: k('2026-10-11') as Date | null,
  lockedThrough: k('2026-09-30') as Date | null,
  now,
}

function status(fn: () => void): number {
  try { fn() } catch (e) {
    if (e instanceof PdcError || e instanceof AccountingError) return e.status
    throw e
  }
  return 0
}

test('today passes', () => {
  assert.equal(status(() => validateClearingDate(base)), 0)
})

test('today late at night Karachi time passes (Karachi day, not UTC day)', () => {
  // 2026-11-09 23:30 Karachi = 18:30 UTC; now = 2026-11-09 00:30 Karachi = 2026-11-08 19:30 UTC
  const n = new Date('2026-11-08T19:30:00Z')
  assert.equal(status(() => validateClearingDate({ ...base, now: n, clearingDate: new Date('2026-11-09T18:30:00Z') })), 0)
})

test('received the same day (later time) passes', () => {
  assert.equal(status(() => validateClearingDate({ ...base, receivedDate: new Date('2026-11-09T09:00:00Z') })), 0)
})

test('before received date is refused (400)', () => {
  assert.equal(status(() => validateClearingDate({ ...base, clearingDate: k('2026-10-31') })), 400)
})

test('a future Karachi day is refused (400)', () => {
  assert.equal(status(() => validateClearingDate({ ...base, clearingDate: k('2026-11-10') })), 400)
})

test('before go-live is refused', () => {
  const s = status(() =>
    validateClearingDate({ ...base, receivedDate: k('2026-10-01'), clearingDate: k('2026-10-10') }),
  )
  assert.ok(s >= 400, `expected refusal, got ${s}`)
})

test('on go-live day passes', () => {
  assert.equal(status(() => validateClearingDate({ ...base, receivedDate: k('2026-10-01'), clearingDate: k('2026-10-11') })), 0)
})

test('on lockedThrough is refused (409)', () => {
  const s = status(() =>
    validateClearingDate({ ...base, goLiveDate: null, receivedDate: k('2026-09-01'), lockedThrough: k('2026-11-05'), clearingDate: k('2026-11-05') }),
  )
  assert.equal(s, 409)
})

test('before lockedThrough is refused (409)', () => {
  const s = status(() =>
    validateClearingDate({ ...base, goLiveDate: null, receivedDate: k('2026-09-01'), lockedThrough: k('2026-11-05'), clearingDate: k('2026-11-01') }),
  )
  assert.equal(s, 409)
})

test('day after lockedThrough passes', () => {
  assert.equal(status(() => validateClearingDate({ ...base, lockedThrough: k('2026-11-08') })), 0)
})

test('invalid clearing date is refused (400)', () => {
  assert.equal(status(() => validateClearingDate({ ...base, clearingDate: new Date('nope') })), 400)
})

test('chequeAmountPaisa converts exactly once to integer paisa', () => {
  assert.equal(chequeAmountPaisa('1234.56'), 123456)
  assert.equal(chequeAmountPaisa(0.1 + 0.2), 30)
  assert.equal(chequeAmountPaisa({ toString: () => '1.005' }), 101)
})

test('chequeAmountPaisa refuses non-positive or non-numeric amounts', () => {
  assert.equal(status(() => chequeAmountPaisa('0')), 400)
  assert.equal(status(() => chequeAmountPaisa('-5')), 400)
  assert.equal(status(() => chequeAmountPaisa('abc')), 400)
  assert.equal(status(() => chequeAmountPaisa(null)), 400)
})
