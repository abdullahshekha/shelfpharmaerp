import { test } from 'node:test'
import assert from 'node:assert/strict'
import { depreciationPaisa, monthlyDepreciation, lastDayOfMonth, monthDiff, regularMonthlyAmount, type DepreciableAsset } from '../../lib/accounting/depreciation'

function addMonths(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number)
  const t = y * 12 + (mo - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
const sumLife = (a: DepreciableAsset, extra = 5) => {
  let s = 0
  for (let i = -3; i < a.usefulLifeMonths + extra; i++) s += depreciationPaisa(a, addMonths(a.purchaseMonth, i))
  return s
}
const base: DepreciableAsset = { cost: 120000, salvageValue: 0, usefulLifeMonths: 12, purchaseMonth: '2026-03' }

test('full life: equal months, sum equals cost - salvage', () => {
  assert.equal(monthlyDepreciation(base, '2026-03'), 10000)
  assert.equal(monthlyDepreciation(base, '2027-02'), 10000)
  assert.equal(sumLife(base), 12000000)
  assert.equal(monthlyDepreciation(base, '2027-03'), 0) // beyond life
})

test('first depreciation month is the purchase month; earlier months are 0', () => {
  assert.equal(monthlyDepreciation(base, '2026-02'), 0)
  assert.equal(monthlyDepreciation(base, '2025-03'), 0)
  assert.equal(monthlyDepreciation(base, '2026-03'), 10000)
})

test('rounding remainder lands in the final month; total exact', () => {
  const a: DepreciableAsset = { cost: 1000, salvageValue: 0, usefulLifeMonths: 3, purchaseMonth: '2026-01' }
  assert.equal(depreciationPaisa(a, '2026-01'), 33333)
  assert.equal(depreciationPaisa(a, '2026-02'), 33333)
  assert.equal(depreciationPaisa(a, '2026-03'), 33334)
  assert.equal(sumLife(a), 100000)
  const b: DepreciableAsset = { cost: 100000.01, salvageValue: 12345.67, usefulLifeMonths: 7, purchaseMonth: '2026-11' }
  assert.equal(sumLife(b), 10000001 - 1234567)
})

test('salvage >= cost -> 0', () => {
  assert.equal(depreciationPaisa({ ...base, salvageValue: 120000 }, '2026-03'), 0)
  assert.equal(depreciationPaisa({ ...base, salvageValue: 200000 }, '2026-03'), 0)
  assert.equal(sumLife({ ...base, salvageValue: 200000 }), 0)
})

test('life of 1 month takes everything in the purchase month', () => {
  const a: DepreciableAsset = { cost: 500.55, salvageValue: 0.55, usefulLifeMonths: 1, purchaseMonth: '2026-06' }
  assert.equal(monthlyDepreciation(a, '2026-06'), 500)
  assert.equal(monthlyDepreciation(a, '2026-07'), 0)
})

test('final month is capped at what is left (never exceeds cost - salvage)', () => {
  const a: DepreciableAsset = { cost: 100, salvageValue: 1, usefulLifeMonths: 7, purchaseMonth: '2026-01' }
  // 9900 paisa / 7 = 1414 r 2 -> 6 x 1414 + 1416
  assert.equal(depreciationPaisa(a, '2026-06'), 1414)
  assert.equal(depreciationPaisa(a, '2026-07'), 1416)
  assert.equal(sumLife(a, 50), 9900)
})

test('disposed assets: 0 after the disposal month, normal up to it', () => {
  const a: DepreciableAsset = { ...base, disposedMonth: '2026-06' }
  assert.equal(monthlyDepreciation(a, '2026-06'), 10000)
  assert.equal(monthlyDepreciation(a, '2026-07'), 0)
  assert.equal(monthlyDepreciation(a, '2027-01'), 0)
})

test('year boundaries, month helpers, regular amount', () => {
  assert.equal(monthDiff('2026-11', '2027-02'), 3)
  assert.equal(lastDayOfMonth('2026-02'), '2026-02-28')
  assert.equal(lastDayOfMonth('2028-02'), '2028-02-29')
  assert.equal(lastDayOfMonth('2026-12'), '2026-12-31')
  assert.equal(regularMonthlyAmount({ cost: 1000, salvageValue: 0, usefulLifeMonths: 3 }), 333.33)
  assert.throws(() => monthDiff('2026-13', '2026-01'))
})

import { addMonths as libAddMonths, catchUpMonths } from '../../lib/accounting/depreciation'

test('addMonths crosses year boundaries both ways', () => {
  assert.equal(libAddMonths('2026-11', 3), '2027-02')
  assert.equal(libAddMonths('2026-01', -1), '2025-12')
  assert.equal(libAddMonths('2026-12', 0), '2026-12')
})

test('catchUpMonths: purchase month through requested, never before go-live, capped at useful life', () => {
  assert.deepEqual(catchUpMonths({ purchaseMonth: '2026-05', usefulLifeMonths: 60 }, '2026-01', '2026-08'), ['2026-05', '2026-06', '2026-07', '2026-08'])
  assert.deepEqual(catchUpMonths({ purchaseMonth: '2025-11', usefulLifeMonths: 60 }, '2026-02', '2026-04'), ['2026-02', '2026-03', '2026-04'])
  assert.deepEqual(catchUpMonths({ purchaseMonth: '2026-01', usefulLifeMonths: 3 }, '2026-01', '2026-12'), ['2026-01', '2026-02', '2026-03'])
  assert.deepEqual(catchUpMonths({ purchaseMonth: '2026-09', usefulLifeMonths: 3 }, '2026-01', '2026-08'), [])
})

// ---- opening assets (bought before go-live) ----
import { remainingDepreciablePaisa } from '../../lib/accounting/depreciation'

/** Simulates the route: each catch-up month posts depreciationPaisa(asset, m, postedSoFar). */
function runCatchUp(a: DepreciableAsset, goLive: string, through: string): number[] {
  const out: number[] = []
  let posted = 0
  for (const m of catchUpMonths(a, goLive, through)) {
    const p = depreciationPaisa(a, m, posted)
    if (p > 0) { out.push(p); posted += p }
  }
  return out
}

test('opening asset mid-life: schedule unchanged, starts at go-live month', () => {
  // 12000 over 12 months from 2026-01 = 1000/month; 5 months (Jan-May) booked before a June go-live.
  const a: DepreciableAsset = { cost: 12000, salvageValue: 0, usefulLifeMonths: 12, purchaseMonth: '2026-01', openingAccumulated: 5000 }
  assert.deepEqual(catchUpMonths(a, '2026-06', '2026-08'), ['2026-06', '2026-07', '2026-08'])
  const posted = runCatchUp(a, '2026-06', '2027-06')
  assert.deepEqual(posted, Array(7).fill(100000))
  assert.equal(5000 * 100 + posted.reduce((s, x) => s + x, 0), 12000 * 100)
})

test('opening asset already fully depreciated by openingAccumulated: nothing due', () => {
  const a: DepreciableAsset = { cost: 10000, salvageValue: 1000, usefulLifeMonths: 24, purchaseMonth: '2025-01', openingAccumulated: 9000 }
  assert.equal(remainingDepreciablePaisa(a), 0)
  assert.deepEqual(catchUpMonths(a, '2026-01', '2026-06'), [])
  assert.equal(depreciationPaisa(a, '2026-01'), 0)
  assert.deepEqual(runCatchUp(a, '2026-01', '2026-12'), [])
})

test('opening asset: over-stated opening accumulation caps the last month(s)', () => {
  // 1000/month regular; opening says 6500 booked although the schedule implies 6000 by go-live (2026-07).
  const a: DepreciableAsset = { cost: 12000, salvageValue: 0, usefulLifeMonths: 12, purchaseMonth: '2026-01', openingAccumulated: 6500 }
  const posted = runCatchUp(a, '2026-07', '2027-03')
  assert.deepEqual(posted, [100000, 100000, 100000, 100000, 100000, 50000])
  assert.equal(650000 + posted.reduce((s, x) => s + x, 0), 1200000) // never exceeds cost - salvage
  // postedPaisa caps a single month directly as well
  assert.equal(depreciationPaisa(a, '2026-12', 500000), 50000)
  assert.equal(depreciationPaisa(a, '2026-12', 550000), 0)
})

test('openingAccumulated 0 / absent leaves the plain schedule (backwards compatible)', () => {
  const a: DepreciableAsset = { cost: 1000, salvageValue: 0, usefulLifeMonths: 3, purchaseMonth: '2026-01' }
  assert.deepEqual(['2026-01', '2026-02', '2026-03'].map((m) => depreciationPaisa(a, m)), [33333, 33333, 33334])
  assert.deepEqual(['2026-01', '2026-02', '2026-03'].map((m) => depreciationPaisa({ ...a, openingAccumulated: 0 }, m, 0)), [33333, 33333, 33334])
  assert.deepEqual(catchUpMonths({ ...a, openingAccumulated: 0 }, '2026-01', '2026-12'), ['2026-01', '2026-02', '2026-03'])
})
