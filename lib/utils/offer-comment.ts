import { calcPurchasePercent, calcTradeOfferPercent } from './pricing'

export const COMMENT_TYPES = [
  { value: 'NONE', label: 'None' },
  { value: 'EXPIRY', label: 'Expiry Date' },
  { value: 'NET_PRICE', label: 'Net Price' },
  { value: 'BONUS', label: 'Bonus' },
  { value: 'EXTRA_PERCENT', label: 'Extra %' },
] as const

export type CommentType = (typeof COMMENT_TYPES)[number]['value']

interface OfferCommentFields {
  offerPercent: unknown
  commentType: string
  commentNetPrice: unknown
  commentMinOrderQty: number | null
  commentQtyFree: number | null
  commentExtraPercent: unknown
}

/** The exact per-type Comments display string used across the editable list, HTML export, and PDF. */
export function formatOfferComment(item: OfferCommentFields, expiryMMYY: string | null): string {
  switch (item.commentType) {
    case 'EXPIRY':
      return expiryMMYY ?? '—'
    case 'NET_PRICE':
      return item.commentNetPrice != null ? `${Number(item.commentNetPrice).toFixed(1)} Net` : '—'
    case 'BONUS':
      return item.commentMinOrderQty != null && item.commentQtyFree != null
        ? `${item.commentMinOrderQty} + ${item.commentQtyFree}`
        : '—'
    case 'EXTRA_PERCENT':
      return item.commentMinOrderQty != null && item.commentExtraPercent != null
        ? `${item.commentMinOrderQty} pcs. ${(Number(item.offerPercent) + Number(item.commentExtraPercent)).toFixed(1)}%`
        : '—'
    default:
      return '—'
  }
}

/**
 * Flags an Offer List line as a loss when the effective price a customer would actually pay —
 * after Offer % and whatever discount the Comment implies — is less than the batch's Purchase
 * Price. Net Price is an absolute override (compared directly); Bonus converts its Min. Order
 * Qty/Qty Free into an equivalent discount and compounds it with Offer % multiplicatively, same
 * convention as calcPurchasePrice; Extra % is added directly to Offer % per its display formula.
 */
export function isOfferAtLoss(item: OfferCommentFields, tradePrice: number | null, purchasePrice: number | null): boolean {
  if (tradePrice == null || purchasePrice == null) return false
  const offerPercent = Number(item.offerPercent)

  if (item.commentType === 'NET_PRICE') {
    if (item.commentNetPrice == null) return false
    return Number(item.commentNetPrice) < purchasePrice
  }

  let effectivePercent = offerPercent
  if (item.commentType === 'BONUS' && item.commentMinOrderQty != null && item.commentQtyFree != null) {
    const bonusPercent = calcTradeOfferPercent(item.commentMinOrderQty, item.commentQtyFree)
    effectivePercent = calcPurchasePercent(offerPercent, bonusPercent)
  } else if (item.commentType === 'EXTRA_PERCENT' && item.commentExtraPercent != null) {
    effectivePercent = offerPercent + Number(item.commentExtraPercent)
  }

  const effectiveSalePrice = tradePrice * (1 - effectivePercent / 100)
  return effectiveSalePrice < purchasePrice
}
