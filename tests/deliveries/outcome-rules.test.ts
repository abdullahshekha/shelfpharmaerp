import test from 'node:test'
import assert from 'node:assert/strict'
import { validateOutcomeInput } from '../../lib/deliveries/outcome-rules'

const now = new Date('2026-11-09T10:00:00Z')
// Line a: 10 x 100, 10% off = 900, tax 5/unit = 50 -> 950. Line b: 4 x 50, no discount = 200, tax 0 -> 200. Total 1150.00
const order = {
  items: [
    { id: 'a', quantity: 10, unitPrice: 100, offerPercent: 10, salesTax: 5 },
    { id: 'b', quantity: 4, unitPrice: 50, offerPercent: 0, salesTax: 0 },
  ],
}
const cash = { outcome: 'PAID_FULL', method: 'CASH', pictureUrl: 'u' }
const bad = (r: any, re: RegExp) => { assert.equal(r.ok, false); assert.match(r.error, re) }

test('PAID_FULL', () => {
  const r: any = validateOutcomeInput(cash, order, now)
  assert.equal(r.ok, true); assert.equal(r.amountDuePaisa, 115000)
  bad(validateOutcomeInput({ outcome: 'PAID_FULL' }, order, now), /method/)
  bad(validateOutcomeInput({ outcome: 'PAID_FULL', method: 'CASH' }, order, now), /picture/)
  bad(validateOutcomeInput({ outcome: 'PAID_FULL', method: 'BANK', pictureUrl: 'u' }, order, now), /Bank/)
  assert.equal(validateOutcomeInput({ outcome: 'PAID_FULL', method: 'BANK', pictureUrl: 'u', bankAccountId: 'x' }, order, now).ok, true)
  bad(validateOutcomeInput({ outcome: 'PAID_FULL', method: 'CHEQUE', pictureUrl: 'u', chequeDate: '2026-11-20' }, order, now), /number/)
  bad(validateOutcomeInput({ outcome: 'PAID_FULL', method: 'CHEQUE', pictureUrl: 'u', chequeNumber: '1' }, order, now), /date/)
  bad(validateOutcomeInput({ outcome: 'PAID_FULL', method: 'CHEQUE', chequeNumber: '1', chequeDate: '2026-11-20' }, order, now), /picture/)
  assert.equal(validateOutcomeInput({ outcome: 'PAID_FULL', method: 'CHEQUE', pictureUrl: 'u', chequeNumber: '1', chequeDate: '2026-11-20' }, order, now).ok, true)
})

test('PAID_WITH_RETURN worked example', () => {
  // Return 3 of line a: per unit = 100 x 0.9 + 5 = 95 -> 285.00; due = 1150 - 285 = 865.00
  // Also return 1 of line b: per unit = 50 -> total credit 335.00; due 815.00
  const r: any = validateOutcomeInput({ ...cash, outcome: 'PAID_WITH_RETURN', returnedLines: [{ orderItemId: 'a', quantity: 3 }] }, order, now)
  assert.equal(r.ok, true); assert.equal(r.amountDuePaisa, 86500)
  const r2: any = validateOutcomeInput({ ...cash, outcome: 'PAID_WITH_RETURN', returnedLines: [{ orderItemId: 'a', quantity: 3, reason: 'Damaged' }, { orderItemId: 'b', quantity: 1 }] }, order, now)
  assert.equal(r2.amountDuePaisa, 81500)
  assert.deepEqual(r2.returnedLines[0], { orderItemId: 'a', quantity: 3, reason: 'Damaged' })
})

test('PAID_WITH_RETURN invalid', () => {
  const base = { ...cash, outcome: 'PAID_WITH_RETURN' }
  bad(validateOutcomeInput({ ...base, returnedLines: [] }, order, now), /least one/)
  bad(validateOutcomeInput({ ...base, returnedLines: [{ orderItemId: 'a', quantity: 11 }] }, order, now), /exceed/)
  bad(validateOutcomeInput({ ...base, returnedLines: [{ orderItemId: 'a', quantity: 0 }] }, order, now), /positive/)
  bad(validateOutcomeInput({ ...base, returnedLines: [{ orderItemId: 'zz', quantity: 1 }] }, order, now), /belong/)
  bad(validateOutcomeInput({ ...base, returnedLines: [{ orderItemId: 'a', quantity: 10 }, { orderItemId: 'b', quantity: 4 }] }, order, now), /Returned outcome/)
  bad(validateOutcomeInput({ outcome: 'PAID_WITH_RETURN', method: 'CASH', returnedLines: [{ orderItemId: 'a', quantity: 1 }] }, order, now), /picture/)
})

test('RETURNED / ON_HOLD / PAY_LATER', () => {
  assert.equal(validateOutcomeInput({ outcome: 'RETURNED', reason: 'Damaged' }, order, now).ok, true)
  bad(validateOutcomeInput({ outcome: 'RETURNED', reason: 'nope' }, order, now), /reason/)
  bad(validateOutcomeInput({ outcome: 'RETURNED' }, order, now), /reason/)
  assert.equal(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'Shop closed', holdUntil: '2026-11-10' }, order, now).ok, true)
  // late-night UTC: now is 01:00 Nov 10 Karachi; Nov 9 is yesterday there, Nov 10 is today
  const late = new Date('2026-11-09T20:00:00Z')
  assert.equal(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'Shop closed', holdUntil: '2026-11-10T00:00:00+05:00' }, order, late).ok, true)
  bad(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'Shop closed', holdUntil: '2026-11-09T12:00:00+05:00' }, order, late), /past/)
  bad(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'Shop closed', holdUntil: '2026-11-08' }, order, now), /past/)
  bad(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'x', holdUntil: '2026-11-10' }, order, now), /reason/)
  bad(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'Shop closed' }, order, now), /hold-until/)
  const p: any = validateOutcomeInput({ outcome: 'PAY_LATER' }, order, now)
  assert.equal(p.ok, true); assert.equal(p.amountDuePaisa, 115000)
  bad(validateOutcomeInput({ outcome: 'BOGUS' }, order, now), /Unknown/)
})
