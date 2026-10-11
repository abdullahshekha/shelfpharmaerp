import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['ADMIN', 'MANAGER']

interface ReturnItemInput {
  medicineId: string
  batchId?: string | null
  quantity: number
  unitPrice?: number
  restocked?: boolean
  reason?: string
}

function generateReturnNumber() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  return `SP-SRET-${date}-${String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')}`
}

// Cross-customer list of sales returns
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20')
  const retailerId = searchParams.get('retailerId') ?? ''
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  const where: Prisma.SalesReturnWhereInput = {
    ...(retailerId && { retailerId }),
    ...((from || to) && {
      returnDate: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lt: new Date(new Date(to).getTime() + 86400000) }),
      },
    }),
  }

  const [returns, total] = await Promise.all([
    prisma.salesReturn.findMany({
      where,
      include: {
        retailer: { select: { name: true, area: { select: { name: true } } } },
        items: { include: { medicine: { select: { name: true } }, batch: { select: { batchNumber: true } } } },
      },
      orderBy: { returnDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.salesReturn.count({ where }),
  ])

  return NextResponse.json({
    data: returns,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  if (!body.retailerId) return NextResponse.json({ error: 'Customer required' }, { status: 400 })
  const items: ReturnItemInput[] = body.items ?? []
  if (!items.length) return NextResponse.json({ error: 'At least one item required' }, { status: 400 })

  const retailer = await prisma.retailer.findUnique({ where: { id: body.retailerId }, select: { id: true } })
  if (!retailer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const batchIds = items.map(i => i.batchId).filter((b): b is string => !!b)
  const batches = await prisma.medicineBatch.findMany({ where: { id: { in: batchIds } } })
  const batchMap = new Map(batches.map(b => [b.id, b]))

  const computed: { medicineId: string; batchId: string | null; quantity: number; unitPrice: number; lineTotal: number; restocked: boolean; reason: string | null }[] = []
  for (const item of items) {
    if (!item.medicineId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      return NextResponse.json({ error: 'Each item needs a medicine and a whole-number quantity above 0' }, { status: 400 })
    }
    const restocked = item.restocked !== false
    const batch = item.batchId ? batchMap.get(item.batchId) : undefined
    if (restocked && !batch) {
      return NextResponse.json({ error: 'Choose a batch for every item returned to stock' }, { status: 400 })
    }
    if (batch && batch.medicineId !== item.medicineId) {
      return NextResponse.json({ error: 'Batch does not belong to the selected medicine' }, { status: 400 })
    }
    const unitPrice = item.unitPrice !== undefined && item.unitPrice !== null ? Number(item.unitPrice) : Number(batch?.tradePrice ?? NaN)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: 'Each item needs a valid unit price' }, { status: 400 })
    }
    computed.push({
      medicineId: item.medicineId,
      batchId: restocked ? item.batchId! : (batch ? batch.id : null),
      quantity: item.quantity,
      unitPrice,
      lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
      restocked,
      reason: item.reason?.trim() || null,
    })
  }

  const totalAmount = computed.reduce((s, i) => s + i.lineTotal, 0)

  const created = await prisma.$transaction(async (tx) => {
    const ret = await tx.salesReturn.create({
      data: {
        returnNumber: generateReturnNumber(),
        retailerId: body.retailerId,
        returnDate: body.returnDate ? new Date(body.returnDate) : new Date(),
        totalAmount,
        notes: body.notes?.trim() || null,
        items: { create: computed },
      },
      include: { items: true },
    })
    for (const item of computed) {
      if (item.restocked && item.batchId) {
        await tx.medicineBatch.update({ where: { id: item.batchId }, data: { currentQty: { increment: item.quantity } } })
      }
    }
    return ret
  })

  return NextResponse.json({ data: created }, { status: 201 })
}
