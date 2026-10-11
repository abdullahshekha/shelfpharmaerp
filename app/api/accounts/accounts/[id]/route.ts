/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'

export const dynamic = 'force-dynamic'

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const account = await prisma.account.findUnique({ where: { id } })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const data: { name?: string; code?: string; type?: string; subType?: string | null; isActive?: boolean } = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') return NextResponse.json({ error: 'isActive must be true or false' }, { status: 400 })
    if (account.isSystem && body.isActive === false) {
      return NextResponse.json({ error: 'System accounts cannot be deactivated' }, { status: 400 })
    }
    if (body.isActive === false) {
      const st = await prisma.accountingSettings.findFirst({ where: { defaultBankAccountId: id }, select: { id: true } })
      if (st) return NextResponse.json({ error: 'This account is the default bank account in Accounts Settings. Choose another default bank first.' }, { status: 400 })
    }
    data.isActive = body.isActive
  }
  if (body.code !== undefined && body.code !== account.code) {
    if (account.isSystem) return NextResponse.json({ error: 'System account codes cannot be changed' }, { status: 400 })
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    if (!code) return NextResponse.json({ error: 'Code cannot be empty' }, { status: 400 })
    const clash = await prisma.account.findUnique({ where: { code } })
    if (clash) return NextResponse.json({ error: `Account code ${code} is already in use` }, { status: 409 })
    data.code = code
  }
  if (body.type !== undefined && body.type !== account.type) {
    if (account.isSystem) return NextResponse.json({ error: 'System account types cannot be changed' }, { status: 400 })
    if (typeof body.type !== 'string' || !TYPES.includes(body.type)) return NextResponse.json({ error: 'Invalid account type' }, { status: 400 })
    const used = await prisma.journalLine.count({ where: { accountId: id } })
    if (used > 0) return NextResponse.json({ error: 'Cannot change the type of an account that already has postings' }, { status: 400 })
    data.type = body.type
  }
  if (body.systemKey !== undefined && body.systemKey !== account.systemKey) {
    return NextResponse.json({ error: 'The system key cannot be changed' }, { status: 400 })
  }
  if (body.subType !== undefined && body.subType !== account.subType) {
    if (account.isSystem) return NextResponse.json({ error: 'System account sub-types cannot be changed' }, { status: 400 })
    data.subType = typeof body.subType === 'string' && body.subType.trim() ? body.subType.trim() : null
  }

  try {
    const updated = await prisma.account.update({ where: { id }, data })
    return NextResponse.json({ data: updated })
  } catch (err: any) {
    if (err?.code === 'P2002') return NextResponse.json({ error: 'Account code is already in use' }, { status: 409 })
    throw err
  }
}
