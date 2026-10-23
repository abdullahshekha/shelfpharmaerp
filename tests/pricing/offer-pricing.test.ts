import test from 'node:test'
import assert from 'node:assert/strict'
import { priceOfferLine, resolveSalesTax, type OfferRule } from '../../lib/utils/offer-pricing'

const rule = (over: Partial<OfferRule> = {}): OfferRule => ({
  commentType: 'NONE', offerPercent: 0, commentNetPrice: null, commentMinOrderQty: null,
  commentQtyFree: null, commentExtraPercent: null, ...over,
})
const noTax = { salesTax: 0, applicable: false }

test('NONE applies offer percent', () => {
  const l = priceOfferLine(rule({ offerPercent: 5 }), 100, 10, noTax)
  assert.equal(l.unitPrice, 100)
  assert.equal(l.offerPercent, 5)
  assert.equal(l.bonusQty, 0)
  assert.equal(l.lineTotal, 950)
})

test('BONUS gives free units per full multiple of min qty', () => {
  const r = rule({ commentType: 'BONUS', commentMinOrderQty: 10, commentQtyFree: 2 })
  const a = priceOfferLine(r, 100, 25, noTax)
  assert.equal(a.bonusQty, 4)
  assert.equal(a.lineTotal, 2500)
  assert.equal(priceOfferLine(r, 100, 9, noTax).bonusQty, 0)
  assert.equal(priceOfferLine(r, 100, 10, noTax).bonusQty, 2)
})

test('EXTRA_PERCENT adds extra once min qty reached', () => {
  const r = rule({ commentType: 'EXTRA_PERCENT', offerPercent: 5, commentMinOrderQty: 20, commentExtraPercent: 3 })
  assert.equal(priceOfferLine(r, 100, 19, noTax).offerPercent, 5)
  const l = priceOfferLine(r, 100, 20, noTax)
  assert.equal(l.offerPercent, 8)
  assert.equal(l.lineTotal, 1840)
})

test('NET_PRICE overrides price and ignores offer percent', () => {
  const r = rule({ commentType: 'NET_PRICE', offerPercent: 7, commentNetPrice: 80 })
  const l = priceOfferLine(r, 100, 5, noTax)
  assert.equal(l.unitPrice, 80)
  assert.equal(l.offerPercent, 0)
  assert.equal(l.lineTotal, 400)
})

test('NET_PRICE with min/extra discounts from min qty', () => {
  const r = rule({ commentType: 'NET_PRICE', commentNetPrice: 80, commentMinOrderQty: 20, commentExtraPercent: 2 })
  const a = priceOfferLine(r, 100, 19, noTax)
  assert.equal(a.unitPrice, 80)
  assert.equal(a.offerPercent, 0)
  const b = priceOfferLine(r, 100, 20, noTax)
  assert.equal(b.offerPercent, 2)
  assert.equal(b.lineTotal, 1568)
})

test('null fields fall back safely', () => {
  const n = priceOfferLine(rule({ commentType: 'NET_PRICE', offerPercent: 7 }), 100, 5, noTax)
  assert.equal(n.unitPrice, 100)
  assert.equal(n.offerPercent, 0)
  assert.equal(n.lineTotal, 500)
  assert.equal(priceOfferLine(rule({ commentType: 'BONUS', commentQtyFree: 2 }), 100, 50, noTax).bonusQty, 0)
  assert.equal(priceOfferLine(rule({ commentType: 'EXTRA_PERCENT', offerPercent: 5, commentExtraPercent: 3 }), 100, 50, noTax).offerPercent, 5)
})

test('minOrderQty 0 never divides by zero', () => {
  const l = priceOfferLine(rule({ commentType: 'BONUS', commentMinOrderQty: 0, commentQtyFree: 2 }), 100, 10, noTax)
  assert.equal(l.bonusQty, 0)
  assert.ok(Number.isFinite(l.lineTotal))
})

test('sales tax applies to paid units only, when applicable', () => {
  const t = priceOfferLine(rule(), 100, 10, { salesTax: 3, applicable: true })
  assert.equal(t.salesTax, 3)
  assert.equal(t.salesTaxAmount, 30)
  const f = priceOfferLine(rule(), 100, 10, { salesTax: 3, applicable: false })
  assert.equal(f.salesTax, 0)
  assert.equal(f.salesTaxAmount, 0)
  const b = priceOfferLine(rule({ commentType: 'BONUS', commentMinOrderQty: 10, commentQtyFree: 2 }), 100, 10, { salesTax: 3, applicable: true })
  assert.equal(b.bonusQty, 2)
  assert.equal(b.salesTaxAmount, 30)
})

test('resolveSalesTax prefers batch tax', () => {
  assert.equal(resolveSalesTax(null, 4), 4)
  assert.equal(resolveSalesTax(2, 4), 2)
  assert.equal(resolveSalesTax(null, null), 0)
})
