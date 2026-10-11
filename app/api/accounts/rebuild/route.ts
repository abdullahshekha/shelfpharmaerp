import { NextRequest, NextResponse } from 'next/server'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { rebuildAll } from '@/lib/accounting/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Re-syncs every source dated since go-live. Idempotent; reports skipped (locked / pre-go-live) and failed records.
export async function POST(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const report = await rebuildAll()
  return NextResponse.json({ data: report })
}
