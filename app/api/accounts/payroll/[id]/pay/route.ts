/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { ensureChart } from '@/lib/accounting/accounts'
import { AccountingError, assertManualPostable, getSettings, karachiDayKey, postEntry, type LineInput } from '@/lib/accounting/core'
import { parseDateInput } from '@/lib/accounting/dates'
import { toPaisa } from '@/lib/accounting/money'
import { CASH_BANK_SUBTYPES } from '@/lib/accounting/cash-routes'
import { bad, loadRunDetail, lockRun } from '@/lib/accounting/payroll'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

// POSTED -> PAID. Dr SALARIES_PAYABLE (per employee) / Cr cash-bank. The whole run is paid at once.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON')
  }
  try {
    const date = parseDateInput(body?.date)
    if (!date) bad('Invalid payment date')
    if (karachiDayKey(date) > karachiDayKey(new Date())) bad('Payment date cannot be in the future')
    if (typeof body.fromAccountId !== 'string' || !body.fromAccountId) bad('Choose the cash/bank account the salaries are paid from')
    if (body.requestId !== undefined && body.requestId !== null && body.requestId !== '' && (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.requestId))) bad('Invalid requestId')
    await prisma.$transaction(
      async (tx) => {
        await lockRun(tx, id)
        const run = await tx.payrollRun.findUnique({ where: { id }, include: { lines: true } })
        if (!run) throw new AccountingError(404, 'Payroll run not found')
        if (run.status === 'PAID') throw new AccountingError(409, 'This run is already paid')
        if (run.status !== 'POSTED') throw new AccountingError(409, 'Post the run before paying it')
        const acc = await tx.account.findUnique({ where: { id: body.fromAccountId } })
        if (!acc || !acc.isActive || acc.type !== 'ASSET' || !acc.subType || !CASH_BANK_SUBTYPES.includes(acc.subType)) throw new AccountingError(400, 'Pay from an active cash or bank account')
        assertManualPostable(await getSettings(tx), date)
        const posted = await tx.journalEntry.findFirst({ where: { sourceType: 'PAYROLL', sourceId: id }, select: { date: true } })
        if (!posted) throw new AccountingError(409, 'The payroll entry is missing from the ledger — re-open and post the run again')
        if (karachiDayKey(date) < karachiDayKey(posted.date)) throw new AccountingError(400, 'Payment date is before the payroll posting date')
        const payable = run.lines.map((l) => ({ employeeId: l.employeeId, p: toPaisa(Number(l.netPay)) })).filter((l) => l.p > 0)
        const total = payable.reduce((s, l) => s + l.p, 0)
        const chart = await ensureChart(tx)
        const lines: LineInput[] = [
          ...payable.map((l) => ({ accountId: chart.SALARIES_PAYABLE, debit: l.p / 100, employeeId: l.employeeId })),
          { accountId: acc.id, credit: total / 100 },
        ]
        await postEntry(tx, { date, memo: `Salaries paid ${run.month}`, sourceType: 'PAYROLL_PAYMENT', sourceId: id, isManual: false, createdById: auth.user.id, lines })
        await tx.payrollRun.update({ where: { id }, data: { status: 'PAID' } })
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: await loadRunDetail(prisma, id) })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}
