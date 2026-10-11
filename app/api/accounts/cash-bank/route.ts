import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { ensureChart } from '@/lib/accounting/accounts'
import { getSettings } from '@/lib/accounting/core'
import { toPaisa } from '@/lib/accounting/money'
import { endExclusive } from '@/lib/accounting/dates'

export const dynamic = 'force-dynamic'

// Cash and bank accounts (subType CASH / BANK) with balances as of today or ?asOf=YYYY-MM-DD.
export async function GET(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const asOfRaw = sp.get('asOf')
  const asOf = asOfRaw ? endExclusive(asOfRaw) : null
  if (asOfRaw && !asOf) return NextResponse.json({ error: 'Invalid asOf date' }, { status: 400 })

  await ensureChart(prisma)
  const [accounts, settings] = await Promise.all([
    prisma.account.findMany({ where: { type: 'ASSET', subType: { in: ['CASH', 'BANK'] }, isActive: true }, orderBy: { code: 'asc' } }),
    getSettings(prisma),
  ])
  const sums = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accounts.map((a) => a.id) }, ...(asOf ? { entry: { date: { lt: asOf } } } : {}) },
    _sum: { debit: true, credit: true },
  })
  const m = new Map(sums.map((s) => [s.accountId, s._sum]))
  let totalPaisa = 0
  const data = accounts.map((a) => {
    const s = m.get(a.id)
    const bal = toPaisa(Number(s?.debit ?? 0)) - toPaisa(Number(s?.credit ?? 0))
    totalPaisa += bal
    return { ...a, balance: bal / 100, isDefaultBank: settings.defaultBankAccountId === a.id }
  })
  return NextResponse.json({
    data,
    meta: {
      total: totalPaisa / 100,
      asOf: asOfRaw,
      goLiveDate: settings.goLiveDate,
      lockedThrough: settings.lockedThrough,
      defaultBankAccountId: settings.defaultBankAccountId,
    },
  })
}
