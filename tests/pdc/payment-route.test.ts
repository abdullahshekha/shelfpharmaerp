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

test('payment method is normalised (case-insensitive, default CASH)', async () => {
  const { normalizePaymentMethod } = await import('../../lib/pdc/from-payment')
  assert.equal(normalizePaymentMethod('cheque'), 'CHEQUE')
  assert.equal(normalizePaymentMethod('Bank_Transfer'), 'BANK_TRANSFER')
  assert.equal(normalizePaymentMethod(undefined), 'CASH')
  assert.equal(normalizePaymentMethod(null), 'CASH')
})

test('payment Date becomes the received date; allowDuplicate passes through only when true', () => {
  const a = chequeInputFromPayment({ ...base, paymentDate: '2026-11-01' }, { retailerId: 'r1' }, 'RECEIVABLE')
  assert.equal(a.receivedDate, '2026-11-01')
  assert.equal(a.allowDuplicate, false)
  const b = chequeInputFromPayment({ ...base, allowDuplicate: true }, { retailerId: 'r1' }, 'RECEIVABLE')
  assert.equal(b.allowDuplicate, true)
  const c = chequeInputFromPayment({ ...base, allowDuplicate: 'true' }, { retailerId: 'r1' }, 'RECEIVABLE')
  assert.equal(c.allowDuplicate, false)
  const d = chequeInputFromPayment({ ...base, paymentDate: undefined }, { retailerId: 'r1' }, 'RECEIVABLE')
  assert.equal(d.receivedDate, null)
})
