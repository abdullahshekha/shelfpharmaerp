import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertBalanced } from '../../lib/accounting/core'
import { toPaisa } from '../../lib/accounting/money'
import { buildBatchWriteoff } from '../../lib/accounting/builders'
import { adjustDeductedQty, restockFefo, restockQtyFor } from '../../lib/accounting/cost'

// ---- Item 1: restock quantities ----
test('restockQtyFor: deductedQty wins, null/undefined falls back to quantity', () => {
  assert.equal(restockQtyFor({ quantity: 10, deductedQty: 4 }), 4)
  assert.equal(restockQtyFor({ quantity: 10, deductedQty: 0 }), 0) // full shortfall: nothing to put back
  assert.equal(restockQtyFor({ quantity: 10, deductedQty: null }), 10) // legacy row
  assert.equal(restockQtyFor({ quantity: 7, deductedQty: undefined }), 7)
  assert.equal(restockQtyFor({ quantity: 7, deductedQty: -3 }), 0) // never negative
})

test('adjustDeductedQty: increase adds what was actually deducted (delta minus shortfall)', () => {
  assert.equal(adjustDeductedQty(10, 10, { deducted: 5 }), 15)
  assert.equal(adjustDeductedQty(10, 10, { deducted: 2 }), 12) // asked 5, only 2 in stock
  assert.equal(adjustDeductedQty(null, 8, { deducted: 2 }), 10) // legacy starts from old quantity
})

test('adjustDeductedQty: decrease subtracts what was restocked, floored at 0', () => {
  assert.equal(adjustDeductedQty(10, 10, { restocked: 3 }), 7)
  assert.equal(adjustDeductedQty(2, 10, { restocked: 5 }), 0) // shortfall order: restocked more than deducted
  assert.equal(adjustDeductedQty(null, 6, { restocked: 0 }), 6) // no batch found: nothing restocked
})

function fakeTx(batches: { id: string; medicineId: string; currentQty: number; expiryDate: Date }[]) {
  const updates: { id: string; data: unknown }[] = []
  const tx = {
    medicineBatch: {
      findFirst: async ({ where }: { where: { medicineId: string } }) =>
        batches.filter((b) => b.medicineId === where.medicineId).sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime())[0] ?? null,
      update: async (args: { where: { id: string }; data: unknown }) => {
        updates.push({ id: args.where.id, data: args.data })
        return {}
      },
    },
  }
  return { tx: tx as never, updates }
}

test('restockFefo: puts the units on the earliest-expiring batch, including an empty one', async () => {
  const { tx, updates } = fakeTx([
    { id: 'late', medicineId: 'm', currentQty: 50, expiryDate: new Date('2027-06-01') },
    { id: 'early', medicineId: 'm', currentQty: 0, expiryDate: new Date('2026-12-01') },
  ])
  const r = await restockFefo(tx, 'm', 4)
  assert.deepEqual(r, { restocked: 4, batchId: 'early', warning: null })
  assert.deepEqual(updates, [{ id: 'early', data: { currentQty: { increment: 4 } } }])
})

test('restockFefo: no batch -> warning, nothing restocked; qty 0 -> no-op', async () => {
  const { tx, updates } = fakeTx([])
  const r = await restockFefo(tx, 'm', 3)
  assert.equal(r.restocked, 0)
  assert.match(r.warning ?? '', /no batch/)
  assert.deepEqual(await restockFefo(tx, 'm', 0), { restocked: 0, batchId: null, warning: null })
  assert.equal(updates.length, 0)
})

// ---- Item 2: batch write-off builder ----
const D = new Date('2026-10-12T06:00:00Z')
const sumKey = (lines: { accountKey?: string; debit?: number; credit?: number }[], key: string, side: 'debit' | 'credit') =>
  lines.filter((l) => l.accountKey === key).reduce((s, l) => s + toPaisa(l[side] ?? 0), 0)

test('batch write-off: Dr Other Expenses / Cr Inventory = qty x purchase price, balanced, memo', () => {
  const r = buildBatchWriteoff({ date: D, medicineName: 'PANADOL', batchNumber: 'B12', quantity: 7, purchasePrice: 12.345 })
  assert.equal(r.length, 1)
  assertBalanced(r[0].lines)
  assert.equal(r[0].date, D)
  assert.equal(r[0].memo, 'Stock write-off: PANADOL batch B12 (7 units)')
  assert.equal(sumKey(r[0].lines, 'OTHER_EXPENSES', 'debit'), toPaisa(86.415)) // paisa-rounded 86.42
  assert.equal(sumKey(r[0].lines, 'INVENTORY', 'credit'), 8642)
  assert.equal(r[0].lines.find((l) => l.accountKey === 'OTHER_EXPENSES')!.memo, r[0].memo)
})

test('batch write-off: zero quantity or zero price posts nothing', () => {
  assert.deepEqual(buildBatchWriteoff({ date: D, medicineName: 'X', batchNumber: '1', quantity: 0, purchasePrice: 10 }), [])
  assert.deepEqual(buildBatchWriteoff({ date: D, medicineName: 'X', batchNumber: '1', quantity: 5, purchasePrice: 0 }), [])
  assert.deepEqual(buildBatchWriteoff({ date: D, medicineName: 'X', batchNumber: '1', quantity: -2, purchasePrice: 10 }), [])
  assert.deepEqual(buildBatchWriteoff({ date: D, medicineName: 'X', batchNumber: '1', quantity: 1, purchasePrice: 0.004 }), []) // rounds to 0
})
