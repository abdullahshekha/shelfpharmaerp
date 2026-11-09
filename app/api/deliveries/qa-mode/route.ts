import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/utils/auth'
import { canManageAssignments } from '@/lib/deliveries/assign-rules'
import { shouldSkipDeliverySync } from '@/lib/deliveries/test-switch'

export const dynamic = 'force-dynamic'

// Test-only diagnostic for tests/deliveries/qa-deliveries.ts: tells the QA script whether this server skips the
// post-commit ledger sync of the order/delivery lifecycle (DELIVERY_TEST_SKIP_SYNC=1), so it can refuse to run
// otherwise. Always 404 in production (where the switch is ignored anyway).
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const user = getUserFromRequest(req)
  if (!user.id || !canManageAssignments(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ skipSync: shouldSkipDeliverySync(process.env) })
}
