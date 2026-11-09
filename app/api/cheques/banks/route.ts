import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { canManageCheques } from '@/lib/pdc/guard'

export const dynamic = 'force-dynamic'

// Bank accounts for the PDC page (filter, cheque bank, clearing bank). The /api/accounts/* routes are
// ADMIN + ACCOUNTANT only, but a MANAGER also clears cheques, so this returns just id/code/name of BANK accounts.
// Inactive ones are included (flagged) so existing cheques still show their bank's name.
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user.id || !canManageCheques(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const data = await prisma.account.findMany({
    where: { type: 'ASSET', subType: 'BANK' },
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: { code: 'asc' },
  })
  return NextResponse.json({ data })
}
