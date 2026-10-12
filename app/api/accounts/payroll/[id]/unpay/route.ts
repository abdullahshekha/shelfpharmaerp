import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError, assertNotLocked, getSettings } from '@/lib/accounting/core'
import { loadRunDetail, lockRun } from '@/lib/accounting/payroll'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

// PAID -> POSTED: removes the PAYROLL_PAYMENT entry. Blocked when that entry is dated in a locked period or
// before go-live. The PAYROLL entry (expense / payable) is left alone.
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
        if (run.status !== 'PAID') throw new AccountingError(409, 'This run is not paid')
        const settings = await getSettings(tx)
        const entries = await tx.journalEntry.findMany({ where: { sourceType: 'PAYROLL_PAYMENT', sourceId: id }, select: { id: true, date: true } })
        for (const e of entries) {
          if (settings.goLiveDate && e.date.getTime() < settings.goLiveDate.getTime()) {
            throw new AccountingError(409, 'The payment entry is dated before the go-live date and cannot be undone')
          }
          try {
            assertNotLocked(settings, e.date)
          } catch (err) {
            throw new AccountingError(409, `${(err as Error).message} — the payment cannot be undone`)
          }
        }
        // Lines cascade with the entry (JournalLine.entry onDelete: Cascade), same as reopen's PAYROLL removal.
        await tx.journalEntry.deleteMany({ where: { sourceType: 'PAYROLL_PAYMENT', sourceId: id } })
        await tx.payrollRun.update({ where: { id }, data: { status: 'POSTED' } })
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: await loadRunDetail(prisma, id) })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}
