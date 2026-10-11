import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, type SessionUser } from '@/lib/utils/auth'

/** All /api/accounts/* routes: ADMIN or ACCOUNTANT only. Return the NextResponse if present, else use `user`. */
export function requireAccountsUser(req: NextRequest): { user: SessionUser } | NextResponse {
  const user = getUserFromRequest(req)
  if (!user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && user.role !== 'ACCOUNTANT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { user }
}
