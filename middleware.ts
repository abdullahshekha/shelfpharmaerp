import { NextRequest, NextResponse } from 'next/server'
import { actorFromStaffSession, buildForwardHeaders, type AuditActor } from '@/lib/audit/actor'
import { isApiAllowedForRole } from '@/lib/utils/role-api-allowlist'

const COOKIE = 'sp_session'
// /api/portal/* is exempt from the staff-cookie check: every portal route authenticates the separate customer
// cookie itself (lib/portal/session.ts). Customers never hold a valid sp_session, so all other /api/* is 401 for them.
const PUBLIC_API = ['/api/auth/login', '/api/auth/logout', '/api/whatsapp/webhook', '/api/portal/']
const FALLBACK_SECRET = 'shelfpharma-erp-secret-2026' // same fallback as lib/utils/auth.ts and the (erp) layout

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacVerify(keyBytes: Uint8Array<ArrayBuffer>, payload: string, sigB64: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, b64urlToBytes(sigB64), new TextEncoder().encode(payload))
}

/** Verified staff session payload (signed with AUTH_SECRET, { id, role } strings), or null. */
async function verifyStaffSession(token: string): Promise<{ id: string; name: string; role: string } | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 1) return null
    const payload = token.slice(0, dot)
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? FALLBACK_SECRET)
    if (!(await hmacVerify(new Uint8Array(secret), payload, token.slice(dot + 1)))) return null
    const s = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)))
    if (typeof s?.id !== 'string' || typeof s?.role !== 'string') return null
    return { id: s.id, name: typeof s.name === 'string' ? s.name : '', role: s.role }
  } catch {
    return null
  }
}

const PORTAL_COOKIE = 'sp_customer' // keep in sync with lib/utils/portal-auth.ts
const PORTAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const PORTAL_SKEW_MS = 5 * 60 * 1000

/** Customer id from a portal cookie signed with the DERIVED key (never the raw secret), or null. */
async function verifyPortalCookie(token: string): Promise<string | null> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 1) return null
    const payload = token.slice(0, dot)
    const raw = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(process.env.AUTH_SECRET ?? FALLBACK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
    const derived = new Uint8Array(await crypto.subtle.sign('HMAC', raw, new TextEncoder().encode('shelfpharma-portal-session-v1')))
    if (!(await hmacVerify(derived, payload, token.slice(dot + 1)))) return null
    const s = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)))
    if (typeof s?.rid !== 'string' || typeof s?.iat !== 'number') return null
    const age = Date.now() - s.iat
    if (age > PORTAL_MAX_AGE_MS || age < -PORTAL_SKEW_MS) return null
    return s.rid
  } catch {
    return null
  }
}

function forward(req: NextRequest, actor: AuditActor | null) {
  return NextResponse.next({ request: { headers: buildForwardHeaders(req.headers, actor) } })
}

// Page auth is handled by the (erp) server component layout; this guards API routes.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!pathname.startsWith('/api/')) return NextResponse.next()

  if (pathname.startsWith('/api/portal/')) {
    const rid = await verifyPortalCookie(req.cookies.get(PORTAL_COOKIE)?.value ?? '')
    // Customer name is not in the cookie; the audit layer records the id.
    return forward(req, rid ? { type: 'CUSTOMER', id: rid, name: 'customer', role: null } : null)
  }
  if (PUBLIC_API.some(p => pathname.startsWith(p))) return forward(req, null)

  const token = req.cookies.get(COOKIE)?.value
  const session = token ? await verifyStaffSession(token) : null
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Role allowlist (only DRIVER is restricted: My Deliveries and what it needs, see lib/utils/role-api-allowlist.ts).
  if (!isApiAllowedForRole(session.role, req.method, pathname)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return forward(req, actorFromStaffSession(session))
}

export const config = {
  matcher: ['/api/:path*'],
}
