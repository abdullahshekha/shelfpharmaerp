import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateOrderNumber } from '@/lib/utils/format'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await prisma.whatsappOrder.findUnique({
    where: { id },
    include: { retailer: true },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: order })
}

// Confirm: convert WhatsApp order to a real Order
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  // body: { retailerId, items: [{medicineId, quantity, unitPrice, offerPercent}] }

  if (!body.retailerId || !body.items?.length) {
    return NextResponse.json({ error: 'retailerId and items are required' }, { status: 400 })
  }

  // Check stock for each item unless force flag set
  if (!body.force) {
    const outOfStock: string[] = []
    for (const item of body.items) {
      const batches = await prisma.medicineBatch.findMany({
        where: { medicineId: item.medicineId, currentQty: { gt: 0 } },
        select: { currentQty: true },
      })
      const totalStock = batches.reduce((s, b) => s + b.currentQty, 0)
      if (totalStock === 0) {
        const med = await prisma.medicine.findUnique({ where: { id: item.medicineId }, select: { name: true } })
        outOfStock.push(med?.name ?? item.medicineId)
      }
    }
    if (outOfStock.length > 0) {
      return NextResponse.json({
        error: `${outOfStock.length} item(s) have no stock: ${outOfStock.join(', ')}. Send with force:true to proceed anyway.`,
        outOfStock,
      }, { status: 409 })
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const orderNumber = generateOrderNumber()

    const newOrder = await tx.order.create({
      data: {
        orderNumber,
        retailerId: body.retailerId,
        source: 'WHATSAPP',
        whatsappOrderId: id,
        items: {
          create: body.items.map((item: {
            medicineId: string; quantity: number; unitPrice: number; offerPercent?: number
          }) => ({
            medicineId: item.medicineId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            offerPercent: item.offerPercent ?? 0,
            bonusQty: 0,
            lineTotal: item.quantity * item.unitPrice * (1 - (item.offerPercent ?? 0) / 100),
          })),
        },
      },
      include: { items: true },
    })

    const totalAmount = newOrder.items.reduce((s, i) => s + Number(i.lineTotal), 0)
    await tx.order.update({ where: { id: newOrder.id }, data: { totalAmount } })

    await tx.whatsappOrder.update({
      where: { id },
      data: { status: 'CONFIRMED', convertedOrderId: newOrder.id },
    })

    return newOrder
  })

  return NextResponse.json({ data: result }, { status: 201 })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.whatsappOrder.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
