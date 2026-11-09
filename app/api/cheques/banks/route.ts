import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { canManageCheques } from '@/lib/pdc/guard'

export const dynamic = 'force-dynamic'

// Bank accounts for cheque screens (PDC page, invoice payment dialogs). The /api/accounts/* routes are
// ADMIN + ACCOUNTANT only, but a MANAGER also records and clears cheques, so this returns just id/code/name of
// active BANK accounts. `?includeInactive=1` adds inactive ones (flagged) so the PDC list can still name them.
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user.id || !canManageCheques(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const data = await prisma.account.findMany({
    where: { type: 'ASSET', subType: 'BANK', ...(req.nextUrl.searchParams.get('includeInactive') === '1' ? {} : { isActive: true }) },
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: { code: 'asc' },
  })
  return NextResponse.json({ data })
}
