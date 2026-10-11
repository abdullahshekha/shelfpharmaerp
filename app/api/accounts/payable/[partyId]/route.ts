import { NextRequest } from 'next/server'
import { partyStatement } from '@/lib/accounting/party-routes'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await params
  return partyStatement(req, 'payable', partyId)
}
