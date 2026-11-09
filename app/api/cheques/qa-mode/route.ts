import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/utils/auth'
import { canManageCheques } from '@/lib/pdc/guard'

export const dynamic = 'force-dynamic'

// Test-only diagnostic for tests/pdc/qa-pdc.ts: tells the QA script whether this server skips the post-clearing
// ledger sync (PDC_TEST_SKIP_SYNC=1), so it can refuse to clear anything otherwise. Always 404 in production.
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const user = getUserFromRequest(req)
  if (!user.id || !canManageCheques(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ skipSync: process.env.PDC_TEST_SKIP_SYNC === '1' })
}
