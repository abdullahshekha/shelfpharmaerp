import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canTransition, allocateOldestFirst, type ChequeStatus, type OpenInvoice } from '../../lib/pdc/rules'

const ALL: ChequeStatus[] = ['PENDING', 'STOPPED', 'RETURNED', 'CLEARED']
const inv = (id: string, duePaisa: number, d: string, c = '2026-01-01T00:00:00Z'): OpenInvoice => ({
  id, duePaisa, sortDate: new Date(d), createdAt: new Date(c),
})

test('PENDING can go to STOPPED, RETURNED, CLEARED', () => {
  assert.equal(canTransition('PENDING', 'CLEARED'), true)
  assert.equal(canTransition('PENDING', 'STOPPED'), true)
  assert.equal(canTransition('PENDING', 'RETURNED'), true)
})

test('CLEARED is final', () => {
  for (const x of ALL) assert.equal(canTransition('CLEARED', x), false)
})

test('STOPPED and RETURNED can reopen to PENDING only', () => {
  assert.equal(canTransition('RETURNED', 'PENDING'), true)
  assert.equal(canTransition('STOPPED', 'PENDING'), true)
  assert.equal(canTransition('RETURNED', 'CLEARED'), false)
  assert.equal(canTransition('STOPPED', 'CLEARED'), false)
})

const three = () => [
  inv('b', 20000, '2026-02-01'),
  inv('a', 10000, '2026-01-01'),
  inv('c', 5000, '2026-03-01'),
]

test('allocates oldest first', () => {
  const r = allocateOldestFirst(three(), 25000)
  assert.deepEqual(r.allocations, [
    { invoiceId: 'a', paisa: 10000 },
    { invoiceId: 'b', paisa: 15000 },
  ])
  assert.equal(r.remainderPaisa, 0)
})

test('remainder when cheque exceeds open invoices', () => {
  const r = allocateOldestFirst(three(), 40000)
  assert.equal(r.remainderPaisa, 5000)
  assert.equal(r.allocations.length, 3)
})

test('zero amount allocates nothing', () => {
  const r = allocateOldestFirst(three(), 0)
  assert.deepEqual(r.allocations, [])
  assert.equal(r.remainderPaisa, 0)
})

test('skips invoices with nothing due', () => {
  const r = allocateOldestFirst([inv('z', 0, '2026-01-01'), inv('a', 100, '2026-01-02')], 50)
  assert.deepEqual(r.allocations, [{ invoiceId: 'a', paisa: 50 }])
})

test('does not mutate input', () => {
  const input = three()
  allocateOldestFirst(input, 100)
  assert.deepEqual(input.map(i => i.id), ['b', 'a', 'c'])
})

test('ties on sortDate broken by createdAt', () => {
  const r = allocateOldestFirst(
    [inv('late', 100, '2026-01-01', '2026-01-02T00:00:00Z'), inv('early', 100, '2026-01-01', '2026-01-01T00:00:00Z')],
    100,
  )
  assert.deepEqual(r.allocations, [{ invoiceId: 'early', paisa: 100 }])
})
