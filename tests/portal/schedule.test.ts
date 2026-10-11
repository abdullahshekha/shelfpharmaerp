import test from 'node:test'
import assert from 'node:assert/strict'
import { nextBookingCutoff } from '../../lib/utils/area-schedule'

const sun10am = new Date('2026-10-11T05:00:00Z') // Sunday 10:00 Karachi
const sun6pm = new Date('2026-10-11T13:00:00Z')  // Sunday 18:00 Karachi
const sat1130pm = new Date('2026-10-10T18:30:00Z') // Saturday 23:30 Karachi

test('no booking days -> null', () => {
  assert.equal(nextBookingCutoff([], sun10am), null)
})

test('today is a booking day and the cut-off has not passed', () => {
  assert.deepEqual(nextBookingCutoff([{ day: 0, cutoffHour: 17 }], sun10am), { day: 0, cutoffHour: 17, isToday: true })
})

test('cut-off passed -> same weekday next week when it is the only booking day', () => {
  assert.deepEqual(nextBookingCutoff([{ day: 0, cutoffHour: 17 }], sun6pm), { day: 0, cutoffHour: 17, isToday: false })
})

test('cut-off passed -> next configured booking day', () => {
  assert.deepEqual(nextBookingCutoff([{ day: 0, cutoffHour: 17 }, { day: 1, cutoffHour: 9 }], sun6pm), { day: 1, cutoffHour: 9, isToday: false })
})

test('hour 0 cut-off tomorrow is not today', () => {
  assert.deepEqual(nextBookingCutoff([{ day: 0, cutoffHour: 0 }], sat1130pm), { day: 0, cutoffHour: 0, isToday: false })
})
