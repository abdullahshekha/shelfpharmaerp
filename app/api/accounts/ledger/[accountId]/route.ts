import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { toPaisa } from '@/lib/accounting/money'
import { endExclusive, parseDateInput } from '@/lib/accounting/dates'

export const dynamic = 'force-dynamic'

// Account ledger: opening balance before `from`, then every line in range with a running balance.
// Rows are capped (limit, default 5000, max 20000): the FIRST rows are kept; opening/totals/closing are aggregates and always exact.
// Debit-normal for ASSET/EXPENSE, credit-normal otherwise. Optional retailerId/supplierId narrow to one party.
export async function GET(req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { accountId } = await params

  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const sp = new URL(req.url).searchParams
  const from = parseDateInput(sp.get('from'))
  const to = endExclusive(sp.get('to'))
  if ((sp.get('from') && !from) || (sp.get('to') && !to)) return NextResponse.json({ error: 'Invalid from/to date' }, { status: 400 })
  const retailerId = sp.get('retailerId')
  const supplierId = sp.get('supplierId')
  const sign = account.type === 'ASSET' || account.type === 'EXPENSE' ? 1 : -1

  const base: Prisma.JournalLineWhereInput = {
    accountId,
    ...(retailerId && { retailerId }),
    ...(supplierId && { supplierId }),
  }

  let openingPaisa = 0
  if (from) {
    const s = await prisma.journalLine.aggregate({
      where: { ...base, entry: { date: { lt: from } } },
      _sum: { debit: true, credit: true },
    })
    openingPaisa = sign * (toPaisa(Number(s._sum.debit ?? 0)) - toPaisa(Number(s._sum.credit ?? 0)))
  }

  const limitRaw = Number(sp.get('limit'))
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(20000, Math.floor(limitRaw)) : 5000
  const rangeWhere: Prisma.JournalLineWhereInput = { ...base, entry: { date: { ...(from && { gte: from }), ...(to && { lt: to }) } } }

  // True range totals come from aggregates, so they stay exact even when the row list is truncated.
  const [agg, totalLines, lines] = await Promise.all([
    prisma.journalLine.aggregate({ where: rangeWhere, _sum: { debit: true, credit: true } }),
    prisma.journalLine.count({ where: rangeWhere }),
    prisma.journalLine.findMany({
      where: rangeWhere,
      include: { entry: { select: { id: true, entryNumber: true, date: true, memo: true, sourceType: true, sourceId: true, isManual: true, createdAt: true } } },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { createdAt: 'asc' } }, { id: 'asc' }],
      take: limit,
    }),
  ])
  const truncated = totalLines > lines.length
  const totalDebit = toPaisa(Number(agg._sum.debit ?? 0))
  const totalCredit = toPaisa(Number(agg._sum.credit ?? 0))
  const closingPaisa = openingPaisa + sign * (totalDebit - totalCredit)

  let running = openingPaisa
  const rows = lines.map((l) => {
    const d = toPaisa(Number(l.debit))
    const c = toPaisa(Number(l.credit))
    running += sign * (d - c)
    return {
      lineId: l.id,
      entryId: l.entry.id,
      entryNumber: l.entry.entryNumber,
      date: l.entry.date,
      memo: l.entry.memo,
      lineMemo: l.memo,
      sourceType: l.entry.sourceType,
      sourceId: l.entry.sourceId,
      isManual: l.entry.isManual,
      retailerId: l.retailerId,
      supplierId: l.supplierId,
      debit: d / 100,
      credit: c / 100,
      balance: running / 100,
    }
  })

  return NextResponse.json({
    data: {
      account: { id: account.id, code: account.code, name: account.name, type: account.type, normal: sign === 1 ? 'DEBIT' : 'CREDIT' },
      opening: openingPaisa / 100,
      totalDebit: totalDebit / 100,
      totalCredit: totalCredit / 100,
      closing: closingPaisa / 100,
      rows,
      truncated,
      totalLines,
      limit,
    },
  })
}
