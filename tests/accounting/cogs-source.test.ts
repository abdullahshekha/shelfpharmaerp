import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cogsSourceFor, cogsQualifyingWhere, type CogsSourceInput } from '../../lib/orders/cogs-source'
import { ORDER_STATUSES } from '../../lib/orders/status'

const A = new Date('2026-11-03T05:00:00Z') // assigned
const D = new Date('2026-11-04T05:00:00Z') // delivered
const I = new Date('2026-11-02T05:00:00Z') // invoiced
const O = new Date('2026-11-01T05:00:00Z') // ordered

test('COGS is dated at assignment', () => {
  const r = cogsSourceFor({ status: 'DELIVERED', assignedAt: A, deliveredAt: D, invoiceDate: I, orderDate: O })
  assert.equal(r.eligible, true)
  assert.equal(r.date, A)
  assert.equal(cogsSourceFor({ status: 'OUT_FOR_DELIVERY', assignedAt: A, deliveredAt: null, invoiceDate: I, orderDate: O }).date, A)
})

test('legacy DELIVERED order (no assignedAt) keeps its old date chain', () => {
  assert.equal(cogsSourceFor({ status: 'DELIVERED', assignedAt: null, deliveredAt: D, invoiceDate: I, orderDate: O }).date, D)
  assert.equal(cogsSourceFor({ status: 'DELIVERED', assignedAt: null, deliveredAt: null, invoiceDate: I, orderDate: O }).date, I)
  assert.equal(cogsSourceFor({ status: 'DELIVERED', assignedAt: undefined, deliveredAt: undefined, invoiceDate: null, orderDate: O }).date, O)
})

test('eligible only while stock is out', () => {
  const base = { assignedAt: A, deliveredAt: null, invoiceDate: I, orderDate: O }
  for (const s of ['OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD', 'RETURNED']) assert.equal(cogsSourceFor({ ...base, status: s }).eligible, true, s)
  // INVOICED (e.g. after an un-assign) yields no entry; so do the other non-stock-out statuses and old vocabulary.
  for (const s of ['RECEIVED', 'INVOICED', 'CANCELLED', 'PENDING', 'CONFIRMED', 'PICKING', 'DISPATCHED', 'DRAFT']) {
    assert.equal(cogsSourceFor({ ...base, status: s }).eligible, false, s)
  }
})

// ---- The rebuild where-clause must select exactly the orders cogsSourceFor() makes eligible on/after `from`. ----
type Row = { status: string; orderDate: Date; delivery: { assignedAt: Date | null; deliveredAt: Date | null } | null; invoice: { invoiceDate: Date } | null }

/* eslint-disable @typescript-eslint/no-explicit-any */
// Minimal evaluator for the Prisma where subset cogsQualifyingWhere() uses (OR/AND, {in}, {gte}, null, {is}).
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === 'OR') return (cond as any[]).some((c) => matches(row, c))
    if (k === 'AND') return (cond as any[]).every((c) => matches(row, c))
    const v = row[k]
    if (cond === null) return v === null
    if (cond && typeof cond === 'object' && 'is' in cond) {
      if (cond.is === null) return v === null
      return v !== null && matches(v, cond.is)
    }
    if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(v)
    if (cond && typeof cond === 'object' && 'gte' in cond) return v !== null && v.getTime() >= cond.gte.getTime()
    throw new Error(`unsupported condition on ${k}`)
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test('cogsQualifyingWhere mirrors cogsSourceFor across every date/relation combination', () => {
  const from = new Date('2026-11-02T12:00:00Z')
  const early = new Date('2026-10-01T00:00:00Z')
  const late = new Date('2026-11-05T00:00:00Z')
  const dates = [null, early, late]
  let checked = 0
  for (const status of [...ORDER_STATUSES, 'PENDING', 'CONFIRMED']) {
    for (const hasDelivery of [false, true]) {
      for (const assignedAt of hasDelivery ? dates : [null]) {
        for (const deliveredAt of hasDelivery ? dates : [null]) {
          for (const invoiceDate of dates) {
            for (const orderDate of [early, late]) {
              const row: Row = {
                status,
                orderDate,
                delivery: hasDelivery ? { assignedAt, deliveredAt } : null,
                invoice: invoiceDate ? { invoiceDate } : null,
              }
              const input: CogsSourceInput = {
                status,
                assignedAt: row.delivery?.assignedAt,
                deliveredAt: row.delivery?.deliveredAt,
                invoiceDate: row.invoice?.invoiceDate,
                orderDate,
              }
              const src = cogsSourceFor(input)
              const expected = src.eligible && src.date.getTime() >= from.getTime()
              assert.equal(matches(row, cogsQualifyingWhere(from)), expected, JSON.stringify(row))
              checked++
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 100)
})
