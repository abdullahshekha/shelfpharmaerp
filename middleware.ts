import { NextRequest, NextResponse } from 'next/server'

const COOKIE = 'sp_session'
const PUBLIC_API = ['/api/auth/login', '/api/auth/logout', '/api/whatsapp/webhook']

// Minimal Edge middleware — only guards API routes.
// Page auth is handled by the (erp) server component layout.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!pathname.startsWith('/api/')) return NextResponse.next()
  if (PUBLIC_API.some(p => pathname.startsWith(p))) return NextResponse.next()

  if (!req.cookies.get(COOKIE)?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
