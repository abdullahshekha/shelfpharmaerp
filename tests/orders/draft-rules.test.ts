import test from 'node:test'
import assert from 'node:assert/strict'
import { isDraftEditable, countsAsSale } from '../../lib/orders/draft'

test('only DRAFT is editable', () => {
  assert.equal(isDraftEditable('DRAFT'), true)
  for (const s of ['PENDING', 'CONFIRMED', 'PICKING', 'DISPATCHED', 'DELIVERED', 'CANCELLED']) assert.equal(isDraftEditable(s), false)
})

test('DRAFT and CANCELLED do not count as a sale', () => {
  assert.equal(countsAsSale('DRAFT'), false)
  assert.equal(countsAsSale('CANCELLED'), false)
  for (const s of ['PENDING', 'CONFIRMED', 'PICKING', 'DISPATCHED', 'DELIVERED']) assert.equal(countsAsSale(s), true)
})
