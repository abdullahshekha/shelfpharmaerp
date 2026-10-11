import { NextRequest } from 'next/server'
import { listParties } from '@/lib/accounting/party-routes'

export const dynamic = 'force-dynamic'

export const GET = (req: NextRequest) => listParties(req, 'payable')
