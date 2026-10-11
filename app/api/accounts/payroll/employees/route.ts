import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'

export const dynamic = 'force-dynamic'

// Active employees with a salary — the pool a payroll run draws from (used by the "select employees" option).
export async function GET(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const rows = await prisma.employee.findMany({
    where: { isActive: true, salary: { gt: 0 } },
    select: { id: true, name: true, role: true, salary: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ data: rows.map((e) => ({ id: e.id, name: e.name, role: e.role, salary: Number(e.salary) })) })
}
