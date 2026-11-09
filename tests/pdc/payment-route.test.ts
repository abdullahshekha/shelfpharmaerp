import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chequeInputFromPayment, PaymentChequeError } from '../../lib/pdc/from-payment'

const base = { amount: '500.50', method: 'CHEQUE', reference: ' 123456 ', paymentDate: '2026-11-09', notes: 'n' }

test('blank reference is rejected', () => {
  for (const reference of ['', '   ', undefined, null]) {
    assert.throws(
      () => chequeInputFromPayment({ ...base, reference }, { retailerId: 'r1' }, 'RECEIVABLE'),
      PaymentChequeError,
    )
  }
})

test('cheque date defaults to payment date, explicit date wins', () => {
  const a = chequeInputFromPayment(base, { retailerId: 'r1' }, 'RECEIVABLE')
  assert.equal(a.chequeDate, '2026-11-09')
  const b = chequeInputFromPayment({ ...base, chequeDate: '2026-12-01' }, { retailerId: 'r1' }, 'RECEIVABLE')
  assert.equal(b.chequeDate, '2026-12-01')
})

test('customer invoice maps to a RECEIVABLE cheque for the retailer', () => {
  const r = chequeInputFromPayment({ ...base, bankAccountId: 'b1' }, { retailerId: 'r1', supplierId: 'ignored' }, 'RECEIVABLE')
  assert.equal(r.direction, 'RECEIVABLE')
  assert.equal(r.retailerId, 'r1')
  assert.equal(r.supplierId, null)
  assert.equal(r.chequeNumber, '123456')
  assert.equal(r.amount, '500.50')
  assert.equal(r.bankAccountId, 'b1')
})

test('purchase invoice maps to a PAYABLE cheque for the supplier', () => {
  const r = chequeInputFromPayment(base, { supplierId: 's1' }, 'PAYABLE')
  assert.equal(r.direction, 'PAYABLE')
  assert.equal(r.supplierId, 's1')
  assert.equal(r.retailerId, null)
  assert.equal(r.bankAccountId, null)
})
