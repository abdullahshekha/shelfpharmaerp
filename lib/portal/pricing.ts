// Pure (no DB) so it can be unit-tested. Everything the browser may see or send passes through here.
import { priceOfferLine, type OfferRule } from '@/lib/utils/offer-pricing'

export interface ServerOfferItem {
  medicineId: string
  code: string
  name: string
  manufacturer: string
  unitPrice: number          // specialPrice ?? FEFO batch trade price
  offerPercent: number
  comment: string            // formatOfferComment(...)
  salesTax: number           // flat Rs per unit, already resolved (FEFO batch -> offer item -> 0); only applied if salesTaxApplicable
  rule: OfferRule
  salesTaxApplicable: boolean
  mrp: number | null         // FEFO batch MRP snapshot
}

export interface PortalOfferItem {
  medicineId: string
  code: string
  name: string
  manufacturer: string
  unitPrice: number
  offerPercent: number
  comment: string
  rule: OfferRule
  salesTax: number           // 0 when the medicine is not Sales Tax Applicable
}

/** Explicit whitelist — never spread the server item (it is the only place cost/stock-derived data could leak). */
export function toPublicItem(i: ServerOfferItem): PortalOfferItem {
  return {
    medicineId: i.medicineId,
    code: i.code,
    name: i.name,
    manufacturer: i.manufacturer,
    unitPrice: i.unitPrice,
    offerPercent: i.offerPercent,
    comment: i.comment,
    rule: { ...i.rule },
    salesTax: i.salesTaxApplicable ? i.salesTax : 0,
  }
}

export interface PricedLine {
  medicineId: string
  quantity: number
  bonusQty: number
  mrp: number | null
  unitPrice: number
  offerPercent: number
  salesTax: number
  salesTaxAmount: number
  lineTotal: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function priceLine(item: ServerOfferItem, quantity: number): PricedLine {
  const p = priceOfferLine(item.rule, item.unitPrice, quantity, { salesTax: item.salesTax, applicable: item.salesTaxApplicable })
  return {
    medicineId: item.medicineId,
    quantity,
    bonusQty: p.bonusQty,
    mrp: item.mrp,
    unitPrice: p.unitPrice,
    offerPercent: p.offerPercent,
    salesTax: p.salesTax,
    salesTaxAmount: p.salesTaxAmount,
    lineTotal: p.lineTotal,
  }
}

export type CartResult =
  | { ok: true; lines: { medicineId: string; quantity: number }[] }
  | { ok: false; error: string }

const MAX_QTY = 9999
const MAX_LINES = 1000

/** Validates the browser-supplied cart. Prices/other fields in the payload are never read. */
export function sanitizeCart(raw: unknown): CartResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'items must be a list' }
  if (raw.length > MAX_LINES) return { ok: false, error: 'Too many items in one order' }
  const seen = new Set<string>()
  const lines: { medicineId: string; quantity: number }[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') return { ok: false, error: 'Invalid item' }
    const { medicineId, quantity } = row as { medicineId?: unknown; quantity?: unknown }
    if (typeof medicineId !== 'string' || medicineId === '') return { ok: false, error: 'Invalid item' }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY) {
      return { ok: false, error: `Quantity must be a whole number between 0 and ${MAX_QTY}` }
    }
    if (seen.has(medicineId)) return { ok: false, error: 'The same item appears twice' }
    seen.add(medicineId)
    if (quantity > 0) lines.push({ medicineId, quantity })
  }
  return { ok: true, lines }
}

export function buildPricedLines(
  cart: { medicineId: string; quantity: number }[],
  offers: Map<string, ServerOfferItem>,
): { ok: true; lines: PricedLine[]; total: number } | { ok: false; error: string } {
  const lines: PricedLine[] = []
  for (const c of cart) {
    const offer = offers.get(c.medicineId)
    if (!offer) return { ok: false, error: 'An item in your order is not on your offer list' }
    lines.push(priceLine(offer, c.quantity))
  }
  return { ok: true, lines, total: round2(lines.reduce((s, l) => s + l.lineTotal, 0)) }
}
