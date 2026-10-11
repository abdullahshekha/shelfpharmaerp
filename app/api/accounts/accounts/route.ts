import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { ensureChart } from '@/lib/accounting/accounts'
import { toPaisa } from '@/lib/accounting/money'
import { endExclusive } from '@/lib/accounting/dates'

export const dynamic = 'force-dynamic'

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']
const DEBIT_NORMAL = new Set(['ASSET', 'EXPENSE'])

export async function GET(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  await ensureChart(prisma)
  const sp = new URL(req.url).searchParams
  const withBalances = sp.get('balances') === '1' || sp.get('balances') === 'true'
  const includeInactive = sp.get('includeInactive') === '1'
  const type = sp.get('type')

  const accounts = await prisma.account.findMany({
    where: { ...(includeInactive ? {} : { isActive: true }), ...(type ? { type } : {}) },
    orderBy: { code: 'asc' },
  })
  if (!withBalances) return NextResponse.json({ data: accounts })

  const asOf = endExclusive(sp.get('asOf'))
  const sums = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: asOf ? { entry: { date: { lt: asOf } } } : {},
    _sum: { debit: true, credit: true },
  })
  const sumMap = new Map(sums.map((s) => [s.accountId, s._sum]))
  const data = accounts.map((a) => {
    const s = sumMap.get(a.id)
    const debit = toPaisa(Number(s?.debit ?? 0))
    const credit = toPaisa(Number(s?.credit ?? 0))
    const balance = (DEBIT_NORMAL.has(a.type) ? debit - credit : credit - debit) / 100
    return { ...a, debit: debit / 100, credit: credit / 100, balance }
  })
  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const type = typeof body.type === 'string' ? body.type : ''
  if (!code || !name) return NextResponse.json({ error: 'Code and name are required' }, { status: 400 })
  if (!ACCOUNT_TYPES.includes(type)) return NextResponse.json({ error: 'Invalid account type' }, { status: 400 })

  const clash = await prisma.account.findUnique({ where: { code } })
  if (clash) return NextResponse.json({ error: `Account code ${code} is already in use` }, { status: 409 })

  let parentId: string | null = null
  if (body.parentId) {
    const parent = await prisma.account.findUnique({ where: { id: String(body.parentId) } })
    if (!parent) return NextResponse.json({ error: 'Parent account not found' }, { status: 400 })
    parentId = parent.id
  }
  const subType = typeof body.subType === 'string' && body.subType.trim() ? body.subType.trim() : null

  try {
    const created = await prisma.account.create({ data: { code, name, type, subType, parentId, isSystem: false } })
    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err: any) {
    if (err?.code === 'P2002') return NextResponse.json({ error: `Account code ${code} is already in use` }, { status: 409 })
    throw err
  }
}
