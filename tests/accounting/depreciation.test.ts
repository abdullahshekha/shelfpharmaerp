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
