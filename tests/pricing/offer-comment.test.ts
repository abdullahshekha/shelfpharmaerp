import test from 'node:test'
import assert from 'node:assert/strict'
import { formatOfferComment, isOfferAtLoss } from '../../lib/utils/offer-comment'

const base = { offerPercent: 0, commentType: 'NONE', commentNetPrice: null, commentMinOrderQty: null, commentQtyFree: null, commentExtraPercent: null }

test('NET_PRICE plain display', () => {
  assert.equal(formatOfferComment({ ...base, commentType: 'NET_PRICE', commentNetPrice: 245 }, null), '245.0 Net')
})
test('NET_PRICE with MOQ and extra % display', () => {
  assert.equal(
    formatOfferComment({ ...base, commentType: 'NET_PRICE', commentNetPrice: 245, commentMinOrderQty: 20, commentExtraPercent: 2 }, null),
    '245.0 Net (min 20 → extra 2.0%)',
  )
})
test('existing comment strings unchanged', () => {
  assert.equal(formatOfferComment(base, null), '—')
  assert.equal(formatOfferComment({ ...base, commentType: 'EXPIRY' }, '03/27'), '03/27')
  assert.equal(formatOfferComment({ ...base, commentType: 'BONUS', commentMinOrderQty: 10, commentQtyFree: 2 }, null), '10 + 2')
  assert.equal(formatOfferComment({ ...base, offerPercent: 5, commentType: 'EXTRA_PERCENT', commentMinOrderQty: 10, commentExtraPercent: 2 }, null), '10 pcs. 7.0%')
})
test('isOfferAtLoss NET with extra % compares the reduced net price', () => {
  const net = { ...base, commentType: 'NET_PRICE', commentNetPrice: 100, commentMinOrderQty: 20, commentExtraPercent: 10 }
  assert.equal(isOfferAtLoss(net, 120, 95), true) // 90 < 95
  assert.equal(isOfferAtLoss({ ...net, commentExtraPercent: null }, 120, 95), false) // 100 >= 95
})
