import { NextRequest } from 'next/server'
import { createHmac, createHash } from 'crypto'

export interface SessionUser {
  id: string
  name: string
  role: string
}

export function hashPassword(password: string): string {
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret'
  return createHash('sha256').update(password + ':' + secret).digest('hex')
}

export function createSession(data: SessionUser, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function getUserFromRequest(req: NextRequest): SessionUser {
  return {
    id: req.headers.get('x-user-id') ?? '',
    role: req.headers.get('x-user-role') ?? 'UNKNOWN',
    name: req.headers.get('x-user-name') ?? '',
  }
}

export function requireRole(req: NextRequest, ...roles: string[]): boolean {
  const { role } = getUserFromRequest(req)
  return roles.includes(role)
}

// Returns true if the role can delete directly (ADMIN), or false if needs approval / forbidden
export function canDeleteDirectly(role: string): boolean {
  return role === 'ADMIN'
}

export function canRequestDelete(role: string): boolean {
  return role === 'MANAGER'
}
