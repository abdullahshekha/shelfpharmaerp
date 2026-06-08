import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'sp_session'
const PUBLIC = ['/login', '/api/auth/login', '/api/auth/logout', '/api/whatsapp/webhook']

async function decodeSession(
  cookie: string,
  secret: string
): Promise<{ id: string; name: string; role: string } | null> {
  const dot = cookie.lastIndexOf('.')
  if (dot === -1) return null
  const payload = cookie.slice(0, dot)
  const sig = cookie.slice(dot + 1)

  try {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify']
    )
    // base64url → base64 → bytes
    const b64 = sig.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    const valid = await crypto.subtle.verify('HMAC', key, bytes, enc.encode(payload))
    if (!valid) return null

    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
  } catch {
    return null
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/uploads') ||
    pathname === '/favicon.ico' ||
    pathname === '/logo.png' ||
    PUBLIC.some(p => pathname.startsWith(p))
  ) {
    return NextResponse.next()
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret'

  if (!cookie) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  const session = await decodeSession(cookie, secret)

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Attach user info to request headers for downstream handlers
  const res = NextResponse.next()
  res.headers.set('x-user-id', session.id)
  res.headers.set('x-user-role', session.role)
  res.headers.set('x-user-name', session.name)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|whatsapp-test-images).*)'],
}
