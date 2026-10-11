import { test } from 'node:test'
import assert from 'node:assert/strict'
import { karachiDay } from '../../components/accounts/types'

test('karachiDay maps Karachi-midnight UTC to the Karachi calendar day', () => {
  assert.equal(karachiDay('2026-10-10T19:00:00.000Z'), '2026-10-11')
  assert.equal(karachiDay('2026-10-11T18:59:59.000Z'), '2026-10-11')
  assert.equal(karachiDay(new Date('2026-12-31T19:00:00.000Z')), '2027-01-01')
})
