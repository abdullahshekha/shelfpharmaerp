import { NextRequest, NextResponse } from 'next/server'

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

/** True only for a cookie signed with AUTH_SECRET whose payload looks like a staff session ({ id, role } strings). */
async function isValidStaffSession(token: string): Promise<boolean> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 1) return false
    const payload = token.slice(0, dot)
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(process.env.AUTH_SECRET ?? FALLBACK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    )
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(token.slice(dot + 1)), new TextEncoder().encode(payload))
    if (!ok) return false
    const s = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)))
    return typeof s?.id === 'string' && typeof s?.role === 'string'
  } catch {
    return false
  }
}

// Page auth is handled by the (erp) server component layout; this guards API routes.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!pathname.startsWith('/api/')) return NextResponse.next()
  if (PUBLIC_API.some(p => pathname.startsWith(p))) return NextResponse.next()

  const token = req.cookies.get(COOKIE)?.value
  if (!token || !(await isValidStaffSession(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
