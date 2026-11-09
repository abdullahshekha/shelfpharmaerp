import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { parseDateInput, endExclusive } from '@/lib/accounting/dates'
import { canManageCheques } from '@/lib/pdc/guard'
import { createChequeRecord, ChequeError } from '@/lib/pdc/create'

export const dynamic = 'force-dynamic'
const PAGE = 20

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  const isMgr = canManageCheques(user.role)
  if (!isMgr && !(user.role === 'SALESMAN' && user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const sp = req.nextUrl.searchParams
  const where: Prisma.ChequeWhereInput = {}
  if (!isMgr) where.recordedById = user.id
  const direction = sp.get('direction')
  if (direction === 'RECEIVABLE' || direction === 'PAYABLE') where.direction = direction
  const status = sp.get('status')
  if (status) where.status = status
  const bank = sp.get('bankAccountId')
  if (bank) where.bankAccountId = bank
  const party = sp.get('partyId')
  if (party) where.OR = [{ retailerId: party }, { supplierId: party }]
  const ack = sp.get('acknowledged')
  if (ack === 'true') where.acknowledgedAt = { not: null }
  if (ack === 'false') where.acknowledgedAt = null
  const from = parseDateInput(sp.get('from'))
  const to = endExclusive(sp.get('to'))
  if (from || to) where.chequeDate = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) }
  const q = sp.get('q')?.trim()
  if (q) {
    where.AND = [{
      OR: [
        { chequeNumber: { contains: q, mode: 'insensitive' } },
        { drawerBank: { contains: q, mode: 'insensitive' } },
        { retailer: { name: { contains: q, mode: 'insensitive' } } },
        { supplier: { name: { contains: q, mode: 'insensitive' } } },
      ],
    }]
  }
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)

  const [data, total, recv, pay] = await Promise.all([
    prisma.cheque.findMany({
      where,
      orderBy: [{ chequeDate: 'asc' }, { createdAt: 'asc' }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { retailer: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } },
    }),
    prisma.cheque.count({ where }),
    prisma.cheque.aggregate({ where: { AND: [where, { direction: 'RECEIVABLE' }] }, _sum: { amount: true } }),
    prisma.cheque.aggregate({ where: { AND: [where, { direction: 'PAYABLE' }] }, _sum: { amount: true } }),
  ])
  return NextResponse.json({
    data, total,
    totals: { receivable: Number(recv._sum.amount ?? 0), payable: Number(pay._sum.amount ?? 0) },
  })
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  try {
    const data = await createChequeRecord(user, body)
    return NextResponse.json({ data }, { status: 201 })
  } catch (e) {
    if (e instanceof ChequeError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    throw e
  }
}
