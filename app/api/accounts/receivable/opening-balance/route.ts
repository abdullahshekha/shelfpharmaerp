import { NextRequest } from 'next/server'
import { postOpeningBalance } from '@/lib/accounting/party-routes'

export const dynamic = 'force-dynamic'

export const POST = (req: NextRequest) => postOpeningBalance(req, 'receivable')
