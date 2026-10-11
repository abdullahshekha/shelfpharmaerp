/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { ensureChart } from '@/lib/accounting/accounts'

export const dynamic = 'force-dynamic'

// Creates a bank account: ASSET, subType BANK, next free code in 1010-1099 (1010 is the system Bank account).
export async function POST(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (!name) return NextResponse.json({ error: 'Bank account name is required' }, { status: 400 })
  if (name.length > 80) return NextResponse.json({ error: 'Name is too long (max 80 characters)' }, { status: 400 })

  await ensureChart(prisma)
  try {
    const created = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cash-bank-create-account'))`
        const dup = await tx.account.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } })
        if (dup) return { error: `An account named "${name}" already exists` as const }
        const used = new Set((await tx.account.findMany({ where: { code: { gte: '1010', lte: '1099' } }, select: { code: true } })).map((a) => a.code))
        let code: string | null = null
        for (let c = 1011; c <= 1099; c++) {
          if (!used.has(String(c))) { code = String(c); break }
        }
        if (!code) return { error: 'No free bank account codes left (1011-1099)' as const }
        return { account: await tx.account.create({ data: { code, name, type: 'ASSET', subType: 'BANK', isSystem: false } }) }
      },
      { maxWait: 10000, timeout: 15000 },
    )
    if ('error' in created) return NextResponse.json({ error: created.error }, { status: 409 })
    return NextResponse.json({ data: created.account }, { status: 201 })
  } catch (err: any) {
    if (err?.code === 'P2002') return NextResponse.json({ error: 'Account code or name already in use, try again' }, { status: 409 })
    throw err
  }
}
