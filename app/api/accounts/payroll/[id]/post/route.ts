import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { ensureChart } from '@/lib/accounting/accounts'
import { AccountingError, assertManualPostable, getSettings, karachiDayKey, postEntry, type LineInput } from '@/lib/accounting/core'
import { parseDateInput } from '@/lib/accounting/dates'
import { lastDayOfMonth } from '@/lib/accounting/depreciation'
import { toPaisa } from '@/lib/accounting/money'
import { loadRunDetail, lockRun } from '@/lib/accounting/payroll'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

// DRAFT -> POSTED. Dr SALARIES_EXPENSE (Σ net) / Cr SALARIES_PAYABLE (one line per employee), dated the last day of the month.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  try {
    await prisma.$transaction(
      async (tx) => {
        await lockRun(tx, id)
        const run = await tx.payrollRun.findUnique({ where: { id }, include: { lines: true } })
        if (!run) throw new AccountingError(404, 'Payroll run not found')
        if (run.status !== 'DRAFT') throw new AccountingError(409, `This run is already ${run.status === 'POSTED' ? 'posted' : 'paid'}`)
        const settings = await getSettings(tx)
        if (!settings.goLiveDate) throw new AccountingError(409, 'Set a go-live date in Accounts Settings before posting payroll')
        const date = parseDateInput(lastDayOfMonth(run.month))!
        if (karachiDayKey(date) < karachiDayKey(settings.goLiveDate)) {
          throw new AccountingError(409, `${run.month} ends before the go-live date, so its payroll cannot be posted to the ledger`)
        }
        assertManualPostable(settings, date)
        const payable = run.lines.map((l) => ({ employeeId: l.employeeId, p: toPaisa(Number(l.netPay)) })).filter((l) => l.p > 0)
        const total = payable.reduce((s, l) => s + l.p, 0)
        if (total <= 0) throw new AccountingError(400, 'Net pay total is zero — nothing to post')
        const chart = await ensureChart(tx)
        const lines: LineInput[] = [
          { accountId: chart.SALARIES_EXPENSE, debit: total / 100 },
          ...payable.map((l) => ({ accountId: chart.SALARIES_PAYABLE, credit: l.p / 100, employeeId: l.employeeId })),
        ]
        await postEntry(tx, { date, memo: `Payroll ${run.month}`, sourceType: 'PAYROLL', sourceId: id, isManual: false, createdById: auth.user.id, lines })
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
