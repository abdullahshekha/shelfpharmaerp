import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeChequeNumber, chequeDuplicateKey, duplicateChequeMessage, clearedChequeDeleteBlock } from '../../lib/pdc/rules'

test('cheque numbers compare trimmed and case-insensitive', () => {
  assert.equal(normalizeChequeNumber('  Ab-123 '), 'ab-123')
  assert.equal(chequeDuplicateKey('RECEIVABLE', 'r1', ' AB-123'), chequeDuplicateKey('RECEIVABLE', 'r1', 'ab-123 '))
})

test('duplicate key differs by direction, party and number', () => {
  const k = chequeDuplicateKey('RECEIVABLE', 'r1', '123')
  assert.notEqual(k, chequeDuplicateKey('PAYABLE', 'r1', '123'))
  assert.notEqual(k, chequeDuplicateKey('RECEIVABLE', 'r2', '123'))
  assert.notEqual(k, chequeDuplicateKey('RECEIVABLE', 'r1', '124'))
})

test('duplicate message names the cheque, party kind and status', () => {
  assert.equal(duplicateChequeMessage('123', 'RECEIVABLE', 'CLEARED'), 'Cheque 123 is already recorded for this customer (status CLEARED)')
  assert.match(duplicateChequeMessage('9', 'PAYABLE', 'PENDING'), /supplier \(status PENDING\)/)
})

test('hard delete is blocked only by cheque-linked payments', () => {
  assert.equal(clearedChequeDeleteBlock([]), null)
  assert.equal(clearedChequeDeleteBlock([{ chequeId: null }]), null)
  assert.equal(
    clearedChequeDeleteBlock([{ chequeId: null }, { chequeId: 'c1', chequeNumber: '555' }, { chequeId: 'c1', chequeNumber: '555' }]),
    'Paid by cleared cheque 555; cannot delete.',
  )
  assert.equal(clearedChequeDeleteBlock([{ chequeId: 'c1', chequeNumber: 'A' }, { chequeId: 'c2', chequeNumber: 'B' }]), 'Paid by cleared cheque A, B; cannot delete.')
})
