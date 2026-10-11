import { NextResponse } from 'next/server'
import { PORTAL_COOKIE, PORTAL_COOKIE_OPTIONS } from '@/lib/utils/portal-auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const res = NextResponse.json({ success: true })
  res.cookies.set(PORTAL_COOKIE, '', { ...PORTAL_COOKIE_OPTIONS, maxAge: 0 })
  return res
}
