import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/utils/auth'
import { profitLossHandler } from '@/lib/accounting/report-routes'

export const dynamic = 'force-dynamic'

// Reports hub wrapper around the accounts P&L (same numbers, broader roles).
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return profitLossHandler(new URL(req.url).searchParams)
}
