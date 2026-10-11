import test from 'node:test'
import assert from 'node:assert/strict'
import { toPublicItem, priceLine, sanitizeCart, buildPricedLines, type ServerOfferItem } from '../../lib/portal/pricing'

const item = (over: Partial<ServerOfferItem> = {}): ServerOfferItem => ({
  medicineId: 'm1', code: '000001', name: 'ABOCAL TAB', manufacturer: 'ABBOTT', unitPrice: 100, offerPercent: 10,
  comment: '—', salesTax: 5, salesTaxApplicable: true, mrp: 120, ...over,
})

test('toPublicItem exposes only the whitelisted fields', () => {
  const leaky = { ...item(), purchasePercent: 12, purchasePrice: 70, currentQty: 50, batches: [] } as unknown as ServerOfferItem
  assert.deepEqual(Object.keys(toPublicItem(leaky)).sort(),
    ['code', 'comment', 'manufacturer', 'medicineId', 'name', 'offerPercent', 'unitPrice'])
})

test('priceLine mirrors staff order math (tax excluded from lineTotal)', () => {
  const l = priceLine(item(), 3)
  assert.equal(l.lineTotal, 270)
  assert.equal(l.salesTax, 5)
  assert.equal(l.salesTaxAmount, 15)
  assert.equal(l.mrp, 120)
})

test('sales tax is zero when the medicine is not tax-applicable', () => {
  const l = priceLine(item({ salesTaxApplicable: false }), 3)
  assert.equal(l.salesTax, 0)
  assert.equal(l.salesTaxAmount, 0)
})

test('lineTotal is rounded to 2 decimals', () => {
  assert.equal(priceLine(item({ unitPrice: 33.33, offerPercent: 15 }), 3).lineTotal, 84.99)
})

test('sanitizeCart accepts whole quantities 0..9999 and drops zeros', () => {
  const r = sanitizeCart([{ medicineId: 'a', quantity: 2 }, { medicineId: 'b', quantity: 0 }, { medicineId: 'c', quantity: 9999 }])
  assert.deepEqual(r, { ok: true, lines: [{ medicineId: 'a', quantity: 2 }, { medicineId: 'c', quantity: 9999 }] })
  assert.deepEqual(sanitizeCart([]), { ok: true, lines: [] })
})

test('sanitizeCart rejects tampered input', () => {
  const bad: unknown[] = [
    undefined, null, 'x', {},
    [{ medicineId: 'a', quantity: 1.5 }],
    [{ medicineId: 'a', quantity: -1 }],
    [{ medicineId: 'a', quantity: 10000 }],
    [{ medicineId: 'a', quantity: '5' }],
    [{ medicineId: 'a', quantity: NaN }],
    [{ medicineId: '', quantity: 1 }],
    [{ quantity: 1 }],
    [null],
    [{ medicineId: 'a', quantity: 1 }, { medicineId: 'a', quantity: 2 }],
    Array.from({ length: 1001 }, (_, i) => ({ medicineId: `m${i}`, quantity: 1 })),
  ]
  for (const b of bad) assert.equal((sanitizeCart(b) as { ok: boolean }).ok, false, JSON.stringify(b)?.slice(0, 60))
})

test('buildPricedLines prices server-side and totals; ignores client price fields', () => {
  const offers = new Map([['m1', item()], ['m2', item({ medicineId: 'm2', unitPrice: 50, offerPercent: 0, salesTaxApplicable: false })]])
  const cart = [{ medicineId: 'm1', quantity: 3, unitPrice: 0.01 }, { medicineId: 'm2', quantity: 2 }] as { medicineId: string; quantity: number }[]
  const r = buildPricedLines(cart, offers)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.lines[0].unitPrice, 100)
    assert.equal(r.total, 370) // 270 + 100
  }
})

test('buildPricedLines rejects an item that is not on the customer offer list', () => {
  const r = buildPricedLines([{ medicineId: 'foreign', quantity: 1 }], new Map([['m1', item()]]))
  assert.deepEqual(r, { ok: false, error: 'An item in your order is not on your offer list' })
})
