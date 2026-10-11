import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError, assertNotLocked, getSettings } from '@/lib/accounting/core'
import { loadRunDetail, lockRun } from '@/lib/accounting/payroll'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

// POSTED -> DRAFT: removes the PAYROLL entry. Blocked once paid, and when the entry's date is in a locked period.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  try {
    await prisma.$transaction(
      async (tx) => {
        await lockRun(tx, id)
        const run = await tx.payrollRun.findUnique({ where: { id }, select: { status: true } })
        if (!run) throw new AccountingError(404, 'Payroll run not found')
        if (run.status === 'PAID') throw new AccountingError(409, 'A paid run cannot be re-opened')
        if (run.status !== 'POSTED') throw new AccountingError(409, 'Only a posted run can be re-opened')
        const entry = await tx.journalEntry.findFirst({ where: { sourceType: 'PAYROLL', sourceId: id }, select: { date: true } })
        if (entry) {
          try {
            assertNotLocked(await getSettings(tx), entry.date)
          } catch (e) {
            throw new AccountingError(409, (e as Error).message)
          }
        }
        await tx.journalEntry.deleteMany({ where: { sourceType: 'PAYROLL', sourceId: id } })
        await tx.payrollRun.update({ where: { id }, data: { status: 'DRAFT' } })
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: await loadRunDetail(prisma, id) })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}
