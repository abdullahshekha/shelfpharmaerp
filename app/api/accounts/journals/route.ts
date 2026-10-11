import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError, assertBalanced, assertManualPostable, getSettings, postEntry, type LineInput } from '@/lib/accounting/core'
import { endExclusive, parseDateInput } from '@/lib/accounting/dates'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '20') || 20))
  const from = parseDateInput(sp.get('from'))
  const to = endExclusive(sp.get('to'))
  if ((sp.get('from') && !from) || (sp.get('to') && !to)) return NextResponse.json({ error: 'Invalid from/to date' }, { status: 400 })
  const accountId = sp.get('accountId')
  const sourceType = sp.get('sourceType')
  const retailerId = sp.get('retailerId')
  const supplierId = sp.get('supplierId')
  const q = sp.get('q')?.trim()

  const lineWhere: Prisma.JournalLineWhereInput = {
    ...(accountId && { accountId }),
    ...(retailerId && { retailerId }),
    ...(supplierId && { supplierId }),
  }
  const where: Prisma.JournalEntryWhereInput = {
    ...((from || to) && { date: { ...(from && { gte: from }), ...(to && { lt: to }) } }),
    ...(sourceType === 'MANUAL' ? { isManual: true } : sourceType ? { sourceType } : {}),
    ...(Object.keys(lineWhere).length > 0 && { lines: { some: lineWhere } }),
    ...(q && { OR: [{ entryNumber: { contains: q, mode: 'insensitive' } }, { memo: { contains: q, mode: 'insensitive' } }] }),
  }

  const [entries, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      include: { lines: { include: { account: { select: { id: true, code: true, name: true } } } } },
      orderBy: [{ date: 'desc' }, { entryNumber: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.journalEntry.count({ where }),
  ])
  return NextResponse.json({ data: entries, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
}

export async function POST(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const date = body.date ? parseDateInput(body.date) : new Date()
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  if (!Array.isArray(body.lines)) return NextResponse.json({ error: 'lines are required' }, { status: 400 })

  const rawLines: any[] = body.lines
  if (rawLines.some((l) => !l || typeof l !== 'object')) return NextResponse.json({ error: 'Invalid line' }, { status: 400 })
  const partyField = (v: unknown): string | undefined | null => {
    if (v === undefined || v === null || v === '') return undefined
    return typeof v === 'string' ? v : null // null = invalid
  }
  const lines: LineInput[] = []
  for (const l of rawLines) {
    const retailerId = partyField(l.retailerId)
    const supplierId = partyField(l.supplierId)
    const employeeId = partyField(l.employeeId)
    if (retailerId === null || supplierId === null || employeeId === null) {
      return NextResponse.json({ error: 'retailerId/supplierId/employeeId must be strings' }, { status: 400 })
    }
    lines.push({
      accountId: typeof l.accountId === 'string' ? l.accountId : undefined,
      debit: Number(l.debit ?? 0),
      credit: Number(l.credit ?? 0),
      memo: typeof l.memo === 'string' && l.memo.trim() ? l.memo.trim() : undefined,
      retailerId,
      supplierId,
      employeeId,
    })
  }
  if (lines.some((l) => !l.accountId)) return NextResponse.json({ error: 'Every line needs an accountId' }, { status: 400 })

  try {
    assertBalanced(lines)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid entry' }, { status: 400 })
  }

  const accountIds = Array.from(new Set(lines.map((l) => l.accountId!)))
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, isActive: true, systemKey: true } })
  if (accounts.length !== accountIds.length) return NextResponse.json({ error: 'Unknown account on a line' }, { status: 400 })
  if (accounts.some((a) => !a.isActive)) return NextResponse.json({ error: 'An account on a line is inactive' }, { status: 400 })
  const accMap = new Map(accounts.map((a) => [a.id, a]))
  for (const l of lines) {
    const key = accMap.get(l.accountId!)!.systemKey
    if (key === 'AR' && !l.retailerId) return NextResponse.json({ error: 'Accounts Receivable lines need a customer (retailerId)' }, { status: 400 })
    if (key === 'AP' && !l.supplierId) return NextResponse.json({ error: 'Accounts Payable lines need a supplier (supplierId)' }, { status: 400 })
    if (l.retailerId && key !== 'AR') return NextResponse.json({ error: 'A customer can only be set on an Accounts Receivable line' }, { status: 400 })
    if (l.supplierId && key !== 'AP') return NextResponse.json({ error: 'A supplier can only be set on an Accounts Payable line' }, { status: 400 })
  }

  const retailerIds = Array.from(new Set(lines.map((l) => l.retailerId).filter((v): v is string => !!v)))
  const supplierIds = Array.from(new Set(lines.map((l) => l.supplierId).filter((v): v is string => !!v)))
  const employeeIds = Array.from(new Set(lines.map((l) => l.employeeId).filter((v): v is string => !!v)))
  if (retailerIds.length && (await prisma.retailer.count({ where: { id: { in: retailerIds } } })) !== retailerIds.length) {
    return NextResponse.json({ error: 'Unknown customer on a line' }, { status: 400 })
  }
  if (supplierIds.length && (await prisma.supplier.count({ where: { id: { in: supplierIds } } })) !== supplierIds.length) {
    return NextResponse.json({ error: 'Unknown supplier on a line' }, { status: 400 })
  }
  if (employeeIds.length && (await prisma.employee.count({ where: { id: { in: employeeIds } } })) !== employeeIds.length) {
    return NextResponse.json({ error: 'Unknown employee on a line' }, { status: 400 })
  }

  try {
    const entry = await prisma.$transaction(
      async (tx) => {
        assertManualPostable(await getSettings(tx), date)
        return postEntry(tx, {
          date,
          memo: typeof body.memo === 'string' ? body.memo.trim() || undefined : undefined,
          isManual: true,
          createdById: auth.user.id,
          lines,
        })
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    if (err instanceof AccountingError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
