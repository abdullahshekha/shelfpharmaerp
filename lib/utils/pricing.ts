interface BatchForPricing {
  expiryDate: Date | string
  currentQty: number
  // Prisma.Decimal, string, or number — anything Number() can coerce
  tradePrice: unknown
  mrp: unknown
}

interface BatchWithOfferData extends BatchForPricing {
  discountPercent: unknown
  bonusQuantity: number
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

/**
 * Offer List pricing for a medicine, taken from its FEFO batch: Trade Price plus the
 * Disc % and bonus quantity that batch was purchased at (see MedicineBatch.discountPercent/
 * bonusQuantity, snapshotted from the Purchase Invoice line when the batch was created).
 * Null means no in-stock batch exists for this medicine.
 */
export function getEffectiveOffer<T extends BatchWithOfferData>(batches: T[]): {
  tradePrice: number | null
  mrp: number | null
  offerPercent: number
  bonusQty: number
} {
  const batch = getFefoBatch(batches)
  if (!batch) return { tradePrice: null, mrp: null, offerPercent: 0, bonusQty: 0 }
  return {
    tradePrice: Number(batch.tradePrice as string | number),
    mrp: batch.mrp != null ? Number(batch.mrp as string | number) : null,
    offerPercent: Number(batch.discountPercent as string | number),
    bonusQty: batch.bonusQuantity,
  }
}

/**
 * Converts a bonus/free-goods trade offer into an equivalent discount percentage,
 * so its cost can be spread evenly across all units received (actual + bonus).
 * e.g. 10 actual + 2 bonus = paying for 10 units but stocking 12, i.e. a 2/12 ≈ 16.67% discount per unit.
 */
export function calcTradeOfferPercent(actualQuantity: number, bonusQuantity: number): number {
  const totalQuantity = actualQuantity + bonusQuantity
  if (totalQuantity <= 0 || bonusQuantity <= 0) return 0
  return (bonusQuantity / totalQuantity) * 100
}

interface PurchasePriceInput {
  tradePrice: number
  discountPercent: number
  tradeOfferPercent: number
}

/**
 * Purchase price per unit, used for inventory/batch costing (pure cost of goods, no taxes):
 *   ((100 − combined discount%) / 100) × Trade Price
 * Discount% and Trade Offer% (from bonus quantity) are two successive, independent
 * reductions off Trade Price, so they compound multiplicatively rather than being summed —
 * (1 − Discount%/100) × (1 − TradeOffer%/100) — otherwise the invoice value would shift
 * depending on bonus quantity even when Discount% alone should keep it fixed.
 * Sales Tax and Advance Income Tax (Collectible/Payable) are NOT part of Purchase Price —
 * they're calculated separately and totalled at the invoice level instead (see calcSalesTaxAmount,
 * calcAitAmount).
 */
export function calcPurchasePrice({
  tradePrice,
  discountPercent,
  tradeOfferPercent,
}: PurchasePriceInput): number {
  const combinedDiscountFactor = (1 - discountPercent / 100) * (1 - tradeOfferPercent / 100)
  return tradePrice * combinedDiscountFactor
}

/**
 * Advance Income Tax (Collectible or Payable) owed on a purchase invoice line —
 * a rate off Trade Price applied across all units received, kept separate from
 * Purchase Price and totalled at the invoice level instead.
 */
export function calcAitAmount(tradePrice: number, aitPercent: number, totalQuantity: number): number {
  return tradePrice * (aitPercent / 100) * totalQuantity
}

/** Total Sales Tax owed on a purchase invoice line — Sales Tax is a flat Rs value per unit. */
export function calcSalesTaxAmount(salesTax: number, totalQuantity: number): number {
  return salesTax * totalQuantity
}
