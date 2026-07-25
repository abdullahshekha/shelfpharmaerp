interface BatchForPricing {
  expiryDate: Date | string
  currentQty: number
  // Prisma.Decimal, string, or number — anything Number() can coerce
  tradePrice: unknown
  mrp: unknown
}

/** The batch that stock is drawn from first (First-Expiry-First-Out). */
export function getFefoBatch<T extends BatchForPricing>(batches: T[]): T | null {
  const inStock = batches.filter((b) => b.currentQty > 0)
  if (inStock.length === 0) return null
  return inStock.reduce((earliest, b) =>
    new Date(b.expiryDate).getTime() < new Date(earliest.expiryDate).getTime() ? b : earliest
  )
}

/** Effective sale price for a medicine, taken from its FEFO batch. Null tradePrice means no priced stock exists. */
export function getEffectivePrice<T extends BatchForPricing>(batches: T[]): { tradePrice: number | null; mrp: number | null } {
  const batch = getFefoBatch(batches)
  if (!batch) return { tradePrice: null, mrp: null }
  return {
    tradePrice: Number(batch.tradePrice as string | number),
    mrp: batch.mrp != null ? Number(batch.mrp as string | number) : null,
  }
}

interface PurchasePriceInput {
  tradePrice: number
  discountPercent: number
  salesTaxPercent: number
  aitCollectiblePercent: number
  aitPayablePercent: number
}

/**
 * Purchase price after discount and taxes, all computed as percentages of Trade Price:
 * discounted Trade Price + Sales Tax + Advance Income Tax (Collectible) + Advance Income Tax (Payable).
 */
export function calcPurchasePrice({
  tradePrice,
  discountPercent,
  salesTaxPercent,
  aitCollectiblePercent,
  aitPayablePercent,
}: PurchasePriceInput): number {
  const discounted = tradePrice * (1 - discountPercent / 100)
  const salesTax = tradePrice * (salesTaxPercent / 100)
  const aitCollectible = tradePrice * (aitCollectiblePercent / 100)
  const aitPayable = tradePrice * (aitPayablePercent / 100)
  return discounted + salesTax + aitCollectible + aitPayable
}
