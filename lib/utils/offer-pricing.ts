// Pure (no DB). Applies an offer-list item's Comment rule (Bonus / Extra % / Net Price) to a line.

export interface OfferRule {
  commentType: string
  offerPercent: number
  commentNetPrice: number | null
  commentMinOrderQty: number | null
  commentQtyFree: number | null
  commentExtraPercent: number | null
}

export interface PricedOfferLine {
  unitPrice: number
  offerPercent: number
  bonusQty: number
  salesTax: number
  salesTaxAmount: number
  lineTotal: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function priceOfferLine(
  rule: OfferRule,
  basePrice: number,
  quantity: number,
  tax: { salesTax: number; applicable: boolean },
): PricedOfferLine {
  const min = rule.commentMinOrderQty
  const minMet = min != null && min > 0 && quantity >= min
  const extra = rule.commentExtraPercent ?? 0

  let unitPrice = basePrice
  let offerPercent = rule.offerPercent
  let bonusQty = 0

  switch (rule.commentType) {
    case 'BONUS':
      if (min != null && min > 0 && rule.commentQtyFree != null && rule.commentQtyFree > 0) {
        bonusQty = Math.floor(quantity / min) * rule.commentQtyFree
      }
      break
    case 'EXTRA_PERCENT':
      if (minMet) offerPercent = rule.offerPercent + extra
      break
    case 'NET_PRICE':
      if (rule.commentNetPrice != null) {
        unitPrice = rule.commentNetPrice
        offerPercent = minMet ? extra : 0
      }
      break
  }

  const salesTax = tax.applicable ? tax.salesTax : 0
  return {
    unitPrice,
    offerPercent,
    bonusQty,
    salesTax,
    salesTaxAmount: round2(salesTax * quantity),
    lineTotal: round2(quantity * unitPrice * (1 - offerPercent / 100)),
  }
}

/** Batch sales tax wins; falls back to the offer-list item's tax; 0 if neither. */
export function resolveSalesTax(batchTax: number | null, offerTax: number | null): number {
  return batchTax ?? offerTax ?? 0
}
