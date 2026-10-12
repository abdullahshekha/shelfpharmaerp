import type { Prisma } from '@prisma/client'

type Db = Pick<Prisma.TransactionClient, 'medicineBatch'>

/**
 * Deducts `qty` of a medicine from in-stock batches, earliest expiry first (FEFO), allowing partial
 * deductions across batches. Returns the total purchase cost of what was actually deducted
 * (callers divide by the ORDER quantity to get a per-unit COGS cost), the amount deducted and the shortfall.
 */
export async function deductFefo(
  tx: Db,
  medicineId: string,
  qty: number,
): Promise<{ costSum: number; deducted: number; remaining: number }> {
  let remaining = qty
  let costSum = 0
  const batches = await tx.medicineBatch.findMany({
    where: { medicineId, currentQty: { gt: 0 } },
    orderBy: { expiryDate: 'asc' },
  })
  for (const batch of batches) {
    if (remaining <= 0) break
    const deduct = Math.min(batch.currentQty, remaining)
    await tx.medicineBatch.update({
      where: { id: batch.id },
      data: { currentQty: batch.currentQty - deduct },
    })
    costSum += deduct * Number(batch.purchasePrice)
    remaining -= deduct
  }
  const deducted = qty - remaining
  return { costSum, deducted, remaining }
}

/**
 * Puts `qty` units of a medicine back onto its earliest-expiring batch (including batches at currentQty 0 —
 * that is where FEFO took the stock from). Same batch choice as the admin edit of a delivered order.
 * Returns the batch used, or a warning when the medicine has no batch at all (nothing is restocked then).
 */
export async function restockFefo(
  tx: Db,
  medicineId: string,
  qty: number,
): Promise<{ restocked: number; batchId: string | null; warning: string | null }> {
  if (!(qty > 0)) return { restocked: 0, batchId: null, warning: null }
  const batch = await tx.medicineBatch.findFirst({ where: { medicineId }, orderBy: { expiryDate: 'asc' } })
  if (!batch) return { restocked: 0, batchId: null, warning: `no batch found to restock ${qty} unit(s) onto` }
  await tx.medicineBatch.update({ where: { id: batch.id }, data: { currentQty: { increment: qty } } })
  return { restocked: qty, batchId: batch.id, warning: null }
}

/** Units to put back when a delivered line is undone: what delivery actually deducted (legacy rows: the ordered quantity). */
export function restockQtyFor(item: { quantity: number; deductedQty: number | null | undefined }): number {
  const q = item.deductedQty ?? item.quantity
  return Math.max(0, Math.floor(q))
}

/**
 * New OrderItem.deductedQty after an admin quantity edit on a DELIVERED order.
 *  - increase: + what FEFO actually deducted for the extra units (delta minus the shortfall)
 *  - decrease: - what was restocked (0 when no batch existed), floored at 0
 * A null/legacy deductedQty starts from the old ordered quantity.
 */
export function adjustDeductedQty(
  current: number | null | undefined,
  oldQuantity: number,
  change: { deducted?: number; restocked?: number },
): number {
  const base = current ?? oldQuantity
  return Math.max(0, base + (change.deducted ?? 0) - (change.restocked ?? 0))
}

/** Per-unit cost stored on OrderItem.unitCost (4 dp): total deducted cost over the ordered quantity. */
export function unitCostFrom(costSum: number, qty: number): number {
  return Math.round((costSum / qty) * 10000) / 10000
}

/**
 * New per-unit cost after an admin quantity increase on a delivered order: the old lines keep their
 * cost, the extra units carry `extraCostSum` (0 if nothing could be deducted, which dilutes the cost).
 * A null old cost stays null.
 */
export function blendUnitCost(oldQty: number, oldCost: number | null | undefined, extraCostSum: number, delta: number): number | null {
  if (oldCost === null || oldCost === undefined) return null
  return unitCostFrom(oldQty * oldCost + extraCostSum, oldQty + delta)
}
