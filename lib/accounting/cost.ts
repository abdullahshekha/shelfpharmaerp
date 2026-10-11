import type { Prisma } from '@prisma/client'

type Db = Pick<Prisma.TransactionClient, 'medicineBatch'>

/**
 * Deducts `qty` of a medicine from in-stock batches, earliest expiry first (FEFO), allowing partial
 * deductions across batches. Returns the weighted purchase cost per unit of what was actually
 * deducted (null if nothing was deducted, e.g. no batches), the amount deducted and the shortfall.
 */
export async function deductFefo(
  tx: Db,
  medicineId: string,
  qty: number,
): Promise<{ unitCost: number | null; deducted: number; remaining: number }> {
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
  return { unitCost: deducted > 0 ? Math.round((costSum / deducted) * 100) / 100 : null, deducted, remaining }
}
