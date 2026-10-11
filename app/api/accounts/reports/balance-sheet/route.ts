import { NextRequest, NextResponse } from 'next/server'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { balanceSheetHandler } from '@/lib/accounting/report-routes'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  return balanceSheetHandler(new URL(req.url).searchParams)
}
