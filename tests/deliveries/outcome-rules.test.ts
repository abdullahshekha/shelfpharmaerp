import test from 'node:test'
import assert from 'node:assert/strict'
import { validateOutcomeInput } from '../../lib/deliveries/outcome-rules'

const now = new Date('2026-11-09T10:00:00Z')
// Stored values. a: 10 x 100 @10% => lineTotal 900, tax 5/unit => 50. b: 4 x 50 => 200, no tax.
// c: 3 x 33.33 @10% => 89.991 stored as 89.99. Order-level discount 20.
// Invoice total = 900 + 200 + 89.99 - 20 + 50 = 1219.99
const order = {
  items: [
    { id: 'a', quantity: 10, lineTotal: 900, salesTaxAmount: 50 },
    { id: 'b', quantity: 4, lineTotal: 200, salesTaxAmount: 0 },
    { id: 'c', quantity: 3, lineTotal: 89.99, salesTaxAmount: 0 },
  ],
  discountAmount: 20,
}
const cash = { outcome: 'PAID_FULL', method: 'CASH', pictureUrl: 'u' }
const bad = (r: any, re: RegExp) => { assert.equal(r.ok, false); assert.match(r.error, re) }

test('PAID_FULL', () => {
  const r: any = validateOutcomeInput(cash, order, now)
  assert.equal(r.ok, true); assert.equal(r.amountDuePaisa, 121999)
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
  const pr = (lines: any[]) => validateOutcomeInput({ ...cash, outcome: 'PAID_WITH_RETURN', returnedLines: lines }, order, now) as any
  // 3 of a: 900 x 3/10 = 270 + tax 50 x 3/10 = 15 => credit 285.00; due 1219.99 - 285 = 934.99 (order discount not credited back)
  assert.equal(pr([{ orderItemId: 'a', quantity: 3 }]).amountDuePaisa, 93499)
  // all 3 of c: credits the stored 89.99 exactly (not 90.00); due 1130.00
  assert.equal(pr([{ orderItemId: 'c', quantity: 3 }]).amountDuePaisa, 113000)
  // partial 1 of c: round(8999 / 3) = 3000 paisa; due 1219.99 - 30.00 = 1189.99
  assert.equal(pr([{ orderItemId: 'c', quantity: 1 }]).amountDuePaisa, 118999)
  const r2 = pr([{ orderItemId: 'a', quantity: 3, reason: 'late' }, { orderItemId: 'b', quantity: 1 }])
  // credit 285 + 50 = 335 => 884.99
  assert.equal(r2.amountDuePaisa, 88499)
  assert.deepEqual(r2.returnedLines[0], { orderItemId: 'a', quantity: 3, reason: 'late' })
  bad(pr([{ orderItemId: 'a', quantity: 1, reason: 'Damaged' }]), /reason/)
})

test('PAID_WITH_RETURN invalid', () => {
  const base = { ...cash, outcome: 'PAID_WITH_RETURN' }
  bad(validateOutcomeInput({ ...base, returnedLines: [] }, order, now), /least one/)
  bad(validateOutcomeInput({ ...base, returnedLines: [{ orderItemId: 'a', quantity: 11 }] }, order, now), /exceed/)
  bad(validateOutcomeInput({ ...base, returnedLines: [{ orderItemId: 'a', quantity: 0 }] }, order, now), /positive/)
  bad(validateOutcomeInput({ ...base, returnedLines: [{ orderItemId: 'zz', quantity: 1 }] }, order, now), /belong/)
  bad(validateOutcomeInput({ ...base, returnedLines: [{ orderItemId: 'a', quantity: 10 }, { orderItemId: 'b', quantity: 4 }, { orderItemId: 'c', quantity: 3 }] }, order, now), /Returned outcome/)
  bad(validateOutcomeInput({ outcome: 'PAID_WITH_RETURN', method: 'CASH', returnedLines: [{ orderItemId: 'a', quantity: 1 }] }, order, now), /picture/)
})

test('RETURNED / ON_HOLD / PAY_LATER', () => {
  assert.equal(validateOutcomeInput({ outcome: 'RETURNED', reason: 'late' }, order, now).ok, true)
  bad(validateOutcomeInput({ outcome: 'RETURNED', reason: 'nope' }, order, now), /reason/)
  bad(validateOutcomeInput({ outcome: 'RETURNED' }, order, now), /reason/)
  assert.equal(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'shop closed', holdUntil: '2026-11-10' }, order, now).ok, true)
  // late-night UTC: now is 01:00 Nov 10 Karachi; Nov 9 is yesterday there, Nov 10 is today
  const late = new Date('2026-11-09T20:00:00Z')
  assert.equal(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'shop closed', holdUntil: '2026-11-10T00:00:00+05:00' }, order, late).ok, true)
  bad(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'shop closed', holdUntil: '2026-11-09T12:00:00+05:00' }, order, late), /past/)
  bad(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'shop closed', holdUntil: '2026-11-08' }, order, now), /past/)
  bad(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'x', holdUntil: '2026-11-10' }, order, now), /reason/)
  bad(validateOutcomeInput({ outcome: 'ON_HOLD', reason: 'shop closed' }, order, now), /hold-until/)
  const p: any = validateOutcomeInput({ outcome: 'PAY_LATER' }, order, now)
  assert.equal(p.ok, true); assert.equal(p.amountDuePaisa, 121999)
  bad(validateOutcomeInput({ outcome: 'BOGUS' }, order, now), /Unknown/)
})
