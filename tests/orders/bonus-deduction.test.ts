import test from 'node:test'
import assert from 'node:assert/strict'
import { totalUnits } from '../../lib/orders/units'
import { unitCostFrom, restockOnDecrease, adjustDeductedQty } from '../../lib/accounting/cost'

test('bonus line deducts quantity + bonusQty', () => {
  assert.equal(totalUnits({ quantity: 25, bonusQty: 4 }), 29)
  assert.equal(totalUnits({ quantity: 25, bonusQty: 0 }), 25)
  assert.equal(totalUnits({ quantity: 25 }), 25)
  assert.equal(totalUnits({ quantity: 25, bonusQty: null }), 25)
})

test('COGS (quantity x unitCost) equals the full cost of every unit shipped, bonus included', () => {
  const costSum = 29 * 10 // 29 units at Rs 10
  assert.equal(25 * unitCostFrom(costSum, 25), costSum)
})

test('admin decrease restocks at most what the line deducted (legacy null = old total)', () => {
  assert.equal(restockOnDecrease(null, totalUnits({ quantity: 25, bonusQty: 4 }), -10), 10)
  assert.equal(restockOnDecrease(5, 29, -10), 5)
  assert.equal(adjustDeductedQty(null, 29, { deducted: 3 }), 32)
})
