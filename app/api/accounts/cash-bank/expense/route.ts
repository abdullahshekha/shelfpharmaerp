import { NextRequest } from 'next/server'
import { postCashEntry } from '@/lib/accounting/cash-routes'

export const dynamic = 'force-dynamic'

export const POST = (req: NextRequest) => postCashEntry(req, 'expense')
