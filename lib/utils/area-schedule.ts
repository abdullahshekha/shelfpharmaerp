export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export type BookingDay = { day: number; cutoffHour: number }

// Validates/normalises client input; returns null when invalid.
export function parseSchedule(body: { deliveryDays?: unknown; bookingDays?: unknown }) {
  const isDay = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6
  const out: { deliveryDays?: number[]; bookingDays?: BookingDay[] } = {}
  if (body.deliveryDays !== undefined) {
    if (!Array.isArray(body.deliveryDays) || !body.deliveryDays.every(isDay)) return null
    out.deliveryDays = Array.from(new Set(body.deliveryDays as number[])).sort()
  }
  if (body.bookingDays !== undefined) {
    if (!Array.isArray(body.bookingDays)) return null
    const seen = new Map<number, number>()
    for (const b of body.bookingDays as BookingDay[]) {
      if (!b || !isDay(b.day) || !Number.isInteger(b.cutoffHour) || b.cutoffHour < 0 || b.cutoffHour > 23) return null
      seen.set(b.day, b.cutoffHour)
    }
    out.bookingDays = Array.from(seen, ([day, cutoffHour]) => ({ day, cutoffHour })).sort((a, b) => a.day - b.day)
  }
  return out
}

export interface NextBooking { day: number; cutoffHour: number; isToday: boolean }

/** The next upcoming booking cut-off, using the Asia/Karachi clock. Null when the area has no booking days. */
export function nextBookingCutoff(bookingDays: BookingDay[], now: Date = new Date()): NextBooking | null {
  if (!bookingDays.length) return null
  const k = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  for (let ahead = 0; ahead <= 7; ahead++) {
    const dayIdx = (k.getDay() + ahead) % 7
    const b = bookingDays.find(x => x.day === dayIdx)
    if (!b) continue
    if (ahead > 0) return { day: b.day, cutoffHour: b.cutoffHour, isToday: false }
    const cutoff = new Date(k)
    cutoff.setHours(b.cutoffHour, 0, 0, 0)
    if (cutoff > k) return { day: b.day, cutoffHour: b.cutoffHour, isToday: true }
  }
  return null
}
