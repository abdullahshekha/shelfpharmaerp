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

/** Per-unit cost stored on OrderItem.unitCost (4 dp): total deducted cost over the ordered quantity. */
export function unitCostFrom(costSum: number, qty: number): number {
  return Math.round((costSum / qty) * 10000) / 10000
}
