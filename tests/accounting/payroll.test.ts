import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDeduction, netPaisa, joinedMidMonth, joinedAfterMonth, attendanceBounds } from '../../lib/accounting/payroll'

test('no absences -> 0', () => {
  assert.equal(computeDeduction(30000, 0, 0), 0)
})

test('mixed absent + half days', () => {
  assert.equal(computeDeduction(30000, 2, 1), 2500) // 1000/day * 2.5
})

test('half days only', () => {
  assert.equal(computeDeduction(31000, 0, 1), 516.67) // 31000/30*0.5 = 516.666..
  assert.equal(computeDeduction(30000, 0, 2), 1000)
})

test('absences over 30 are capped to salary', () => {
  assert.equal(computeDeduction(30000, 40, 0), 30000)
  assert.equal(computeDeduction(30000, 30, 0), 30000)
  assert.equal(computeDeduction(30000, 29, 4), 30000)
})

test('salary 0 -> 0', () => {
  assert.equal(computeDeduction(0, 5, 2), 0)
})

test('fractional rounding happens in paisa', () => {
  assert.equal(computeDeduction(10000, 1, 0), 333.33)
  assert.equal(computeDeduction(1000.01, 1, 0), 33.33)
  assert.equal(computeDeduction(10000, 2, 0), 666.67)
})

test('never negative', () => {
  assert.equal(computeDeduction(30000, -3, -1), 0)
})

test('netPaisa is exact', () => {
  assert.equal(netPaisa(30000, 333.33, 0.1), 3000000 - 33333 + 10)
  assert.equal(netPaisa(0.1, 0, 0.2), 30)
})

test('mid-month join detection (Karachi)', () => {
  assert.equal(joinedMidMonth('2026-05', new Date('2026-05-01T00:00:00+05:00')), false)
  assert.equal(joinedMidMonth('2026-05', new Date('2026-05-10T00:00:00+05:00')), true)
  assert.equal(joinedMidMonth('2026-05', new Date('2026-04-10T00:00:00+05:00')), false)
  assert.equal(joinedMidMonth('2026-05', null), false)
  assert.equal(joinedAfterMonth('2026-05', new Date('2026-06-01T00:00:00+05:00')), true)
  assert.equal(joinedAfterMonth('2026-05', new Date('2026-05-31T00:00:00+05:00')), false)
})

test('attendance bounds are UTC month edges', () => {
  const b = attendanceBounds('2026-12')
  assert.equal(b.start.toISOString(), '2026-12-01T00:00:00.000Z')
  assert.equal(b.end.toISOString(), '2027-01-01T00:00:00.000Z')
})
