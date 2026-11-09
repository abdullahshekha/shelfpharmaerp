import test from 'node:test'
import assert from 'node:assert/strict'
import { mapOldStatus, canMove, boardColumn, STOCK_OUT_STATUSES, ORDER_STATUSES, type OrderStatus } from '../../lib/orders/status'

test('mapOldStatus covers every legacy value', () => {
  assert.equal(mapOldStatus('PENDING'), 'RECEIVED')
  assert.equal(mapOldStatus('CONFIRMED'), 'INVOICED')
  assert.equal(mapOldStatus('PICKING'), 'INVOICED')
  assert.equal(mapOldStatus('DISPATCHED'), 'OUT_FOR_DELIVERY')
  assert.equal(mapOldStatus('DELIVERED'), 'DELIVERED')
  assert.equal(mapOldStatus('CANCELLED'), 'CANCELLED')
  assert.equal(mapOldStatus('DRAFT'), 'DELETE')
  assert.throws(() => mapOldStatus('WHAT'))
})

test('STOCK_OUT_STATUSES', () => {
  assert.deepEqual([...STOCK_OUT_STATUSES], ['OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'RETURNED'])
})

test('canMove allowed pairs exactly', () => {
  const allowed: Record<string, string[]> = {
    RECEIVED: ['INVOICED', 'CANCELLED'],
    INVOICED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['DELIVERED', 'RETURNED', 'ON_HOLD', 'INVOICED', 'CANCELLED'],
    ON_HOLD: ['OUT_FOR_DELIVERY', 'CANCELLED'],
    DELIVERED: [], RETURNED: [], CANCELLED: [],
  }
  for (const f of ORDER_STATUSES) for (const t of ORDER_STATUSES) {
    assert.equal(canMove(f as OrderStatus, t as OrderStatus), allowed[f].includes(t), `${f}->${t}`)
  }
  assert.equal(canMove('ON_HOLD', 'INVOICED'), false)
})

test('boardColumn', () => {
  const now = new Date('2026-11-09T10:00:00Z')
  const d = { scheduledDate: now }
  assert.equal(boardColumn({ status: 'INVOICED' }, d, now), 'READY')
  assert.equal(boardColumn({ status: 'OUT_FOR_DELIVERY' }, d, now), 'ASSIGNED')
  assert.equal(boardColumn({ status: 'DELIVERED' }, d, now), 'DELIVERED')
  assert.equal(boardColumn({ status: 'RETURNED' }, d, now), 'RETURNED')
  assert.equal(boardColumn({ status: 'RECEIVED' }, d, now), null)
  assert.equal(boardColumn({ status: 'CANCELLED' }, d, now), null)
})

test('ON_HOLD appears only from its Karachi day', () => {
  // 20:00Z on Nov 9 is 01:00 Nov 10 in Karachi
  const now = new Date('2026-11-09T20:00:00Z')
  assert.equal(boardColumn({ status: 'ON_HOLD' }, { scheduledDate: new Date('2026-11-10T00:00:00+05:00') }, now), 'ON_HOLD')
  assert.equal(boardColumn({ status: 'ON_HOLD' }, { scheduledDate: new Date('2026-11-11T00:00:00+05:00') }, now), null)
  assert.equal(boardColumn({ status: 'ON_HOLD' }, { scheduledDate: new Date('2026-11-09T00:00:00+05:00') }, now), 'ON_HOLD')
})
