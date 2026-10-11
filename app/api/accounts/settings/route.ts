import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { getSettings } from '@/lib/accounting/core'
import { parseDateInput } from '@/lib/accounting/dates'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const settings = await getSettings(prisma)
  return NextResponse.json({ data: settings })
}

export async function PUT(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data: { goLiveDate?: Date | null; lockedThrough?: Date | null; defaultBankAccountId?: string | null } = {}
  for (const key of ['goLiveDate', 'lockedThrough'] as const) {
    if (body[key] === undefined) continue
    if (body[key] === null || body[key] === '') {
      data[key] = null
      continue
    }
    const d = parseDateInput(body[key])
    if (!d) return NextResponse.json({ error: `${key} is not a valid date` }, { status: 400 })
    data[key] = d
  }
  if (body.defaultBankAccountId !== undefined) {
    if (body.defaultBankAccountId === null || body.defaultBankAccountId === '') {
      data.defaultBankAccountId = null
    } else {
      const acc = await prisma.account.findUnique({ where: { id: String(body.defaultBankAccountId) } })
      if (!acc || !acc.isActive) return NextResponse.json({ error: 'Default bank account not found or inactive' }, { status: 400 })
      if (acc.type !== 'ASSET' || (acc.subType !== 'BANK' && acc.subType !== 'CASH')) {
        return NextResponse.json({ error: 'Default bank account must be a cash or bank account' }, { status: 400 })
      }
      data.defaultBankAccountId = acc.id
    }
  }

  const current = await getSettings(prisma)
  const updated = await prisma.accountingSettings.update({ where: { id: current.id }, data })
  const goLiveChanged = 'goLiveDate' in data && (data.goLiveDate?.getTime() ?? null) !== (current.goLiveDate?.getTime() ?? null)
  return NextResponse.json({
    data: updated,
    ...(goLiveChanged ? { warning: 'The go-live date changed. Run "Rebuild ledger" so existing records are posted or cleared accordingly.' } : {}),
  })
}
