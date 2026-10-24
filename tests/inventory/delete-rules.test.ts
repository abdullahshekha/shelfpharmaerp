import test from 'node:test'
import assert from 'node:assert/strict'
import { medicineDeleteBlockers } from '../../lib/inventory/delete-rules'

const zero = { stockBatches: 0, purchaseLines: 0, orderLines: 0, returnLines: 0, offerListItems: 0 }

test('unreferenced medicine is deletable', () => assert.deepEqual(medicineDeleteBlockers(zero), []))
test('stock blocks', () => assert.ok(medicineDeleteBlockers({ ...zero, stockBatches: 1 }).length > 0))
test('offer list items block', () => assert.ok(medicineDeleteBlockers({ ...zero, offerListItems: 2 }).length > 0))
test('each reference kind blocks', () => {
  for (const k of ['purchaseLines', 'orderLines', 'returnLines'] as const) {
    assert.equal(medicineDeleteBlockers({ ...zero, [k]: 1 }).length, 1)
  }
})
