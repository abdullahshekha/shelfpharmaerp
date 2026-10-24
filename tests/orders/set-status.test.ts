import test from 'node:test'
import assert from 'node:assert/strict'
import { nextDeliveryColumn, deliveryMismatch } from '../../lib/deliveries/columns'

test('nextDeliveryColumn maps delivery statuses to board columns', () => {
  for (const s of ['SCHEDULED', 'RESCHEDULED', 'FAILED']) assert.equal(nextDeliveryColumn(s), 'TO_DISPATCH')
  assert.equal(nextDeliveryColumn('OUT_FOR_DELIVERY'), 'OUT')
  assert.equal(nextDeliveryColumn('DELIVERED'), 'DELIVERED')
})

test('deliveryMismatch only when delivery is DELIVERED and the order is not', () => {
  assert.equal(deliveryMismatch('DELIVERED', 'CONFIRMED'), true)
  assert.equal(deliveryMismatch('DELIVERED', 'DISPATCHED'), true)
  assert.equal(deliveryMismatch('DELIVERED', 'DELIVERED'), false)
  assert.equal(deliveryMismatch('SCHEDULED', 'CONFIRMED'), false)
  assert.equal(deliveryMismatch('OUT_FOR_DELIVERY', 'DISPATCHED'), false)
})
