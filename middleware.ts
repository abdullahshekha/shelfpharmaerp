import { NextRequest, NextResponse } from 'next/server'

const COOKIE = 'sp_session'
const PUBLIC = ['/login', '/api/auth/login', '/api/auth/logout', '/api/whatsapp/webhook']

// Middleware runs in Edge runtime — keep it simple (no crypto, no async).
// Session verification (HMAC) is handled in Node.js API routes via lib/utils/auth.ts
export function middleware(req: NextRequest) {
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

  if (!req.cookies.get(COOKIE)?.value) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('from', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|whatsapp-test-images).*)'],
}
