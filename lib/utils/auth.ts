import { NextRequest } from 'next/server'
import { createHmac, createHash } from 'crypto'

export interface SessionUser {
  id: string
  name: string
  role: string
}

const COOKIE = 'sp_session'
const FALLBACK_SECRET = 'shelfpharma-erp-secret-2026'

export function hashPassword(password: string): string {
  const secret = process.env.AUTH_SECRET ?? FALLBACK_SECRET
  return createHash('sha256').update(password + ':' + secret).digest('hex')
}

export function createSession(data: SessionUser, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function decodeSession(cookie: string, secret: string): SessionUser | null {
  try {
    const dot = cookie.lastIndexOf('.')
    if (dot === -1) return null
    const payload = cookie.slice(0, dot)
    const sig = cookie.slice(dot + 1)
    const expected = createHmac('sha256', secret).update(payload).digest('base64url')
    if (sig !== expected) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
  } catch {
    return null
  }
}

// Used by API route handlers — Node.js runtime, full crypto available
export function getUserFromRequest(req: NextRequest): SessionUser {
  const secret = process.env.AUTH_SECRET ?? FALLBACK_SECRET
  const cookie = req.cookies.get(COOKIE)?.value ?? ''
  return decodeSession(cookie, secret) ?? { id: '', role: 'UNKNOWN', name: '' }
}

export function requireRole(req: NextRequest, ...roles: string[]): boolean {
  return roles.includes(getUserFromRequest(req).role)
}

export function canDeleteDirectly(role: string): boolean {
  return role === 'ADMIN'
}

export function canRequestDelete(role: string): boolean {
  return role === 'MANAGER'
}
