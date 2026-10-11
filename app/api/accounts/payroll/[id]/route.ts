import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError } from '@/lib/accounting/core'
import { loadRunDetail, lockRun } from '@/lib/accounting/payroll'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const data = await loadRunDetail(prisma, id)
  if (!data) return fail('Payroll run not found', 404)
  return NextResponse.json({ data })
}

// Only a DRAFT run can be deleted (lines cascade). Nothing is in the ledger for a draft.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  try {
    await prisma.$transaction(
      async (tx) => {
        await lockRun(tx, id)
        const run = await tx.payrollRun.findUnique({ where: { id }, select: { status: true } })
        if (!run) throw new AccountingError(404, 'Payroll run not found')
        if (run.status !== 'DRAFT') throw new AccountingError(409, 'Only a draft run can be deleted — re-open a posted run first')
        await tx.payrollRun.delete({ where: { id } })
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: { id } })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}
