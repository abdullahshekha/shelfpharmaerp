import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

export const PORTAL_COOKIE = 'sp_customer'
export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 15
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const FALLBACK_SECRET = 'shelfpharma-erp-secret-2026' // same fallback the staff session uses

export const PORTAL_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_MS / 1000,
  secure: process.env.NODE_ENV === 'production',
}

const secret = () => process.env.AUTH_SECRET ?? FALLBACK_SECRET
// Domain-separated signing key: a portal token must never validate as a staff sp_session token
// (which is signed with the raw secret) and vice versa.
const portalKey = () => createHmac('sha256', secret()).update('shelfpharma-portal-session-v1').digest()
const CLOCK_SKEW_MS = 5 * 60 * 1000

// Stored as "<saltHex>:<hashHex>" — scrypt, per-user random salt.
export function hashPortalPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPortalPassword(password: string, stored: string): boolean {
  if (typeof password !== 'string' || typeof stored !== 'string') return false
  const [saltHex, hashHex, ...rest] = stored.split(':')
  if (rest.length || !saltHex || !hashHex) return false
  // Fixed 16-byte salt and 64-byte hash only.
  if (!/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(hashHex)) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64)
  return timingSafeEqual(actual, expected)
}

export interface PortalSession { rid: string; v: number; iat: number }

export function createPortalSession(data: { rid: string; v: number }, iat: number = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ rid: data.rid, v: data.v, iat })).toString('base64url')
  const sig = createHmac('sha256', portalKey()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function decodePortalSession(token: string, now: number = Date.now()): PortalSession | null {
  try {
    if (typeof token !== 'string') return null
    const dot = token.lastIndexOf('.')
    if (dot === -1) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    const expected = createHmac('sha256', portalKey()).update(payload).digest('base64url')
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as PortalSession
    if (typeof s.rid !== 'string' || typeof s.v !== 'number' || typeof s.iat !== 'number') return null
    if (now - s.iat > SESSION_MAX_AGE_MS) return null
    if (s.iat - now > CLOCK_SKEW_MS) return null
    return s
  } catch {
    return null
  }
}

/** Lowercased, trimmed, 3–32 chars of [a-z0-9._-]; null when invalid. */
export function validatePortalUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const u = raw.trim().toLowerCase()
  return /^[a-z0-9._-]{3,32}$/.test(u) ? u : null
}

export function validatePortalPassword(raw: unknown): boolean {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 200
}
