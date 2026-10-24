export interface MedicineUsage {
  stockBatches: number   // batches that still hold stock (currentQty > 0)
  purchaseLines: number
  orderLines: number
  returnLines: number    // supplier + sales return lines
  offerListItems: number // offer list items + customer quantity-sheet items
}

/** Reasons a medicine cannot be hard-deleted; empty when it is safe to delete. */
export function medicineDeleteBlockers(c: MedicineUsage): string[] {
  const out: string[] = []
  if (c.stockBatches > 0) out.push(`${c.stockBatches} batch(es) still hold stock`)
  if (c.purchaseLines > 0) out.push(`${c.purchaseLines} purchase invoice line(s)`)
  if (c.orderLines > 0) out.push(`${c.orderLines} sales invoice line(s)`)
  if (c.returnLines > 0) out.push(`${c.returnLines} return line(s)`)
  if (c.offerListItems > 0) out.push(`${c.offerListItems} offer list entr${c.offerListItems === 1 ? 'y' : 'ies'}`)
  return out
}
