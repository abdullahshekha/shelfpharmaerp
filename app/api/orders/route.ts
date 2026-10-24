import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { generateOrderNumber } from '@/lib/utils/format'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20')
  const status = searchParams.get('status') ?? ''
  const retailerId = searchParams.get('retailerId') ?? ''
  const source = searchParams.get('source') ?? ''
  const dateFrom = searchParams.get('dateFrom') ?? ''
  const dateTo = searchParams.get('dateTo') ?? ''

  const where: Prisma.OrderWhereInput = {
    ...(status && { status }),
    ...(retailerId && { retailerId }),
    ...(source && { source }),
    ...((dateFrom || dateTo) && {
      orderDate: {
        ...(dateFrom && { gte: new Date(dateFrom) }),
        ...(dateTo   && { lt: new Date(new Date(dateTo).getTime() + 86400000) }),
      },
    }),
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        retailer: { select: { name: true, area: { select: { name: true } } } },
        salesRep: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { orderDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ])

  return NextResponse.json({
    data: orders,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

interface OrderItemInput {
  medicineId: string
  quantity: number
  mrp?: number | null
  unitPrice: number
  offerPercent?: number
  salesTax?: number
  bonusQty?: number
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const items: OrderItemInput[] = body.items

  for (const item of items ?? []) {
    const b = item.bonusQty
    if (b !== undefined && b !== null && (typeof b !== 'number' || !Number.isInteger(b) || b < 0)) {
      return NextResponse.json({ error: 'bonusQty must be a whole number, 0 or more' }, { status: 400 })
    }
  }

  const medicines = await prisma.medicine.findMany({
    where: { id: { in: items.map((i) => i.medicineId) } },
    select: { id: true, salesTaxApplicable: true },
  })
  const medicineMap = new Map(medicines.map((m) => [m.id, m]))

  const order = await prisma.$transaction(async (tx) => {
    const orderNumber = generateOrderNumber()

    const newOrder = await tx.order.create({
      data: {
        orderNumber,
        retailerId: body.retailerId,
        salesRepId: body.salesRepId ?? null,
        source: body.source ?? 'MANUAL',
        ...(body.status === 'DRAFT' ? { status: 'DRAFT' } : {}),
        notes: body.notes ?? null,
        items: {
          create: items.map((item) => {
            const medicine = medicineMap.get(item.medicineId)
            const offerPercent = item.offerPercent ?? 0
            // Sales tax only applies if the medicine is flagged for it.
            const salesTax = medicine?.salesTaxApplicable ? (item.salesTax ?? 0) : 0
            const salesTaxAmount = salesTax * item.quantity
            const lineTotal = item.quantity * item.unitPrice * (1 - offerPercent / 100)
            return {
              medicineId: item.medicineId,
              quantity: item.quantity,
              mrp: item.mrp ?? null,
              unitPrice: item.unitPrice,
              offerPercent,
              salesTax,
              salesTaxAmount,
              bonusQty: item.bonusQty ?? 0,
              lineTotal,
            }
          }),
        },
      },
      include: { items: true },
    })

    const totalAmount = newOrder.items.reduce((sum, i) => sum + Number(i.lineTotal), 0)
    await tx.order.update({ where: { id: newOrder.id }, data: { totalAmount } })

    return { ...newOrder, totalAmount }
  })

  return NextResponse.json({ data: order }, { status: 201 })
}
