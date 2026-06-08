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

export async function POST(req: NextRequest) {
  const body = await req.json()

  const order = await prisma.$transaction(async (tx) => {
    const orderNumber = generateOrderNumber()

    const newOrder = await tx.order.create({
      data: {
        orderNumber,
        retailerId: body.retailerId,
        salesRepId: body.salesRepId ?? null,
        source: body.source ?? 'MANUAL',
        notes: body.notes ?? null,
        items: {
          create: body.items.map((item: {
            medicineId: string
            quantity: number
            unitPrice: number
            offerPercent?: number
            bonusQty?: number
          }) => ({
            medicineId: item.medicineId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            offerPercent: item.offerPercent ?? 0,
            bonusQty: item.bonusQty ?? 0,
            lineTotal: item.quantity * item.unitPrice * (1 - (item.offerPercent ?? 0) / 100),
          })),
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
