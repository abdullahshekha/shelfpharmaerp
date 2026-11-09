// Server-side API allowlist per role, used by middleware.ts (Edge runtime: keep this file dependency-free).
//
// Only DRIVER is restricted (spec call 14: a driver gets My Deliveries only). Every other role is unaffected here;
// their routes keep their own checks. A DRIVER may call exactly what the My Deliveries page and the app shell use:
//   /api/auth/*                         login / logout
//   /api/deliveries[/<seg>...]          any method; the routes scope everything to the driver's own deliveries
//                                       (list, outcome, upload-picture, notes, print/challans)
//   GET /api/cheques/banks              bank list in the outcome dialog
//   GET /api/orders/<id>                single order, already limited to their own delivery (lib/orders/access.ts)
//   GET /api/notifications              unread badge polled by the app shell (own notifications only)
// Anything else under /api is refused. Paths that are not plain (encoded characters, dot segments, empty segments,
// backslashes, control characters, upper case) are refused outright rather than normalised.

const SEGMENT = '[A-Za-z0-9_-]+'
const DELIVERIES = new RegExp(`^/api/deliveries(?:/${SEGMENT})*/?$`)
const AUTH = new RegExp(`^/api/auth/${SEGMENT}/?$`)
const ORDER_BY_ID = new RegExp(`^/api/orders/${SEGMENT}/?$`)
const BANKS = /^\/api\/cheques\/banks\/?$/
const NOTIFICATIONS = /^\/api\/notifications\/?$/

function isPlainPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false
  // Only unreserved path characters: rejects %-encoding, backslashes, whitespace/control characters and the like.
  if (!/^[A-Za-z0-9/_-]+$/.test(pathname.replace(/\./g, ''))) return false
  if (pathname.includes('.')) return false // no dot segments (and no file-like names) under /api
  if (pathname.includes('//')) return false
  return true
}

export function isApiAllowedForRole(role: string | null | undefined, method: string, pathname: string): boolean {
  if (role !== 'DRIVER') return true
  if (!isPlainPath(pathname)) return false
  const m = (method || '').toUpperCase()
  if (AUTH.test(pathname)) return true
  if (DELIVERIES.test(pathname)) return true
  if (m === 'GET' && (BANKS.test(pathname) || ORDER_BY_ID.test(pathname) || NOTIFICATIONS.test(pathname))) return true
  return false
}
