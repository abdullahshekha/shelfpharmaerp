import test from 'node:test'
import assert from 'node:assert/strict'
import { ORDER_STATUSES, ORDER_STATUS_LABEL, canSetViaStatusRoute, confirmClaimError, countsAsSale, PENDING_DEMAND_STATUSES } from '../../lib/orders/status'
import { planConversion } from '../../lib/orders/convert'

test('ORDER_STATUS_LABEL covers every status with the spec wording', () => {
  for (const s of ORDER_STATUSES) assert.ok(ORDER_STATUS_LABEL[s], s)
  assert.equal(Object.keys(ORDER_STATUS_LABEL).length, ORDER_STATUSES.length)
  assert.equal(ORDER_STATUS_LABEL.RECEIVED, 'Order Received')
  assert.equal(ORDER_STATUS_LABEL.INVOICED, 'Invoice Generated')
  assert.equal(ORDER_STATUS_LABEL.OUT_FOR_DELIVERY, 'Out for Delivery')
  assert.equal(ORDER_STATUS_LABEL.ON_HOLD, 'On Hold')
})

test('canSetViaStatusRoute only INVOICED and CANCELLED', () => {
  for (const s of ORDER_STATUSES) assert.equal(canSetViaStatusRoute(s), s === 'INVOICED' || s === 'CANCELLED', s)
  for (const s of ['PENDING', 'CONFIRMED', 'DRAFT', 'PICKING', 'DISPATCHED', 'nope']) assert.equal(canSetViaStatusRoute(s), false)
})

test('countsAsSale: everything except CANCELLED; demand statuses', () => {
  for (const s of ORDER_STATUSES) assert.equal(countsAsSale(s), s !== 'CANCELLED')
  // OUT_FOR_DELIVERY / ON_HOLD stock has already left the warehouse: no longer demand
  assert.deepEqual([...PENDING_DEMAND_STATUSES], ['RECEIVED', 'INVOICED'])
})

test('planConversion maps statuses, deletes drafts, flags undeducted OUT_FOR_DELIVERY', () => {
  const rows = [
    { id: 'a', orderNumber: 'A', status: 'PENDING', deliveryStatus: null, items: [] },
    { id: 'b', orderNumber: 'B', status: 'CONFIRMED', deliveryStatus: 'SCHEDULED', items: [] },
    { id: 'c', orderNumber: 'C', status: 'PICKING', deliveryStatus: 'SCHEDULED', items: [] },
    { id: 'd', orderNumber: 'D', status: 'DRAFT', deliveryStatus: null, items: [] },
    { id: 'e', orderNumber: 'E', status: 'DISPATCHED', deliveryStatus: 'OUT_FOR_DELIVERY', items: [{ deductedQty: null }] },
    { id: 'f', orderNumber: 'F', status: 'DISPATCHED', deliveryStatus: 'OUT_FOR_DELIVERY', items: [{ deductedQty: 5 }] },
    { id: 'g', orderNumber: 'G', status: 'DELIVERED', deliveryStatus: 'DELIVERED', items: [{ deductedQty: null }] },
    { id: 'h', orderNumber: 'H', status: 'RECEIVED', deliveryStatus: null, items: [] },
  ]
  const p = planConversion(rows)
  assert.deepEqual(p.updates.map((u) => [u.id, u.to]), [
    ['a', 'RECEIVED'], ['b', 'INVOICED'], ['c', 'INVOICED'], ['e', 'OUT_FOR_DELIVERY'], ['f', 'OUT_FOR_DELIVERY'],
  ])
  assert.deepEqual(p.deletes, ['d'])
  assert.deepEqual(p.review.map((r) => r.id), ['e'])
  assert.deepEqual(p.counts, { PENDING: 1, CONFIRMED: 1, PICKING: 1, DRAFT: 1, DISPATCHED: 2, DELIVERED: 1, RECEIVED: 1 })
  // Delivery rows of INVOICED orders go back to SCHEDULED; the others stay as they are
  assert.equal(p.updates.find((u) => u.id === 'c')!.deliveryStatus, 'SCHEDULED')
  assert.equal(p.updates.find((u) => u.id === 'e')!.deliveryStatus, null)
  // INVOICED orders are no longer assigned: driver and assignedAt are cleared together
  for (const id of ['b', 'c']) assert.equal(p.updates.find((u) => u.id === id)!.clearDriver, true, id)
  for (const id of ['a', 'e', 'f']) assert.equal(p.updates.find((u) => u.id === id)!.clearDriver, false, id)
})

test('confirmClaimError: only a locked RECEIVED order may be confirmed', () => {
  assert.equal(confirmClaimError('RECEIVED'), null)
  assert.equal(confirmClaimError(null)!.status, 404)
  for (const s of ['CANCELLED', 'INVOICED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'RETURNED']) assert.equal(confirmClaimError(s)!.status, 409, s)
})
