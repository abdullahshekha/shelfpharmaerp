import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canManageCheques, canAcknowledge, canCreateCheque, canEditCheque } from '../../lib/pdc/guard'

const ch = (o: Partial<{ status: string; recordedById: string | null; acknowledgedAt: Date | null }> = {}) => ({
  status: 'PENDING', recordedById: 'u1', acknowledgedAt: null, ...o,
})

test('canManageCheques', () => {
  for (const r of ['ADMIN', 'MANAGER', 'ACCOUNTANT']) assert.equal(canManageCheques(r), true)
  for (const r of ['SALESMAN', 'SALES_REP', 'WAREHOUSE', 'DRIVER', 'UNKNOWN']) assert.equal(canManageCheques(r), false)
})

test('canAcknowledge: ADMIN/MANAGER only', () => {
  assert.equal(canAcknowledge('ADMIN'), true)
  assert.equal(canAcknowledge('MANAGER'), true)
  assert.equal(canAcknowledge('ACCOUNTANT'), false)
  assert.equal(canAcknowledge('SALESMAN'), false)
})

test('canCreateCheque', () => {
  assert.equal(canCreateCheque('ADMIN', 'PAYABLE'), true)
  assert.equal(canCreateCheque('ACCOUNTANT', 'RECEIVABLE'), true)
  assert.equal(canCreateCheque('SALESMAN', 'RECEIVABLE'), true)
  assert.equal(canCreateCheque('SALESMAN', 'PAYABLE'), false)
  assert.equal(canCreateCheque('WAREHOUSE', 'RECEIVABLE'), false)
})

test('canEditCheque: managers full until CLEARED, notes after', () => {
  const m = { id: 'm', role: 'MANAGER' }
  assert.equal(canEditCheque(m, ch()), 'FULL')
  assert.equal(canEditCheque(m, ch({ status: 'STOPPED' })), 'FULL')
  assert.equal(canEditCheque(m, ch({ status: 'CLEARED' })), 'NOTES')
  assert.equal(canEditCheque({ id: 'a', role: 'ACCOUNTANT' }, ch({ status: 'CLEARED' })), 'NOTES')
})

test('canEditCheque: salesman only own unacknowledged', () => {
  const s = { id: 'u1', role: 'SALESMAN' }
  assert.equal(canEditCheque(s, ch()), 'FULL')
  assert.equal(canEditCheque(s, ch({ recordedById: 'other' })), false)
  assert.equal(canEditCheque(s, ch({ acknowledgedAt: new Date() })), false)
  assert.equal(canEditCheque(s, ch({ status: 'CLEARED' })), false)
  assert.equal(canEditCheque({ id: 'u1', role: 'WAREHOUSE' }, ch()), false)
})
