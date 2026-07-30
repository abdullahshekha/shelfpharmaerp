import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; customerId: string }> }) {
  const { id, customerId } = await params

  const sheet = await prisma.offerListCustomer.findUnique({
    where: { id: customerId },
    include: {
      retailer: { select: { id: true, name: true, phone: true } },
      offerList: { select: { id: true, name: true, listNumber: true } },
      items: {
        include: { medicine: { include: { manufacturer: { select: { name: true } } } } },
        orderBy: { medicine: { name: 'asc' } },
      },
    },
  })
  if (!sheet || sheet.offerListId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Pull each item's Offer %/Bonus/TP from the parent offer list, since OfferListCustomerItem only stores quantity.
  const offerItems = await prisma.offerListItem.findMany({ where: { offerListId: id } })
  const offerByMedicine = new Map(offerItems.map((i) => [i.medicineId, i]))

  const items = sheet.items.map((item) => {
    const offer = offerByMedicine.get(item.medicineId)
    return {
      id: item.id,
      medicine: item.medicine,
      quantity: item.quantity,
      offerPercent: offer?.offerPercent ?? 0,
      bonusQty: offer?.bonusQty ?? 0,
      specialPrice: offer?.specialPrice ?? null,
    }
  })

  return NextResponse.json({ data: { ...sheet, items } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; customerId: string }> }) {
  const { id, customerId } = await params
  const body = await req.json()
  const items: { medicineId: string; quantity: number }[] = body.items ?? []

  const sheet = await prisma.offerListCustomer.findUnique({ where: { id: customerId } })
  if (!sheet || sheet.offerListId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction(
    items.map((item) =>
      prisma.offerListCustomerItem.upsert({
        where: { offerListCustomerId_medicineId: { offerListCustomerId: customerId, medicineId: item.medicineId } },
        update: { quantity: item.quantity },
        create: { offerListCustomerId: customerId, medicineId: item.medicineId, quantity: item.quantity },
      })
    )
  )

  return NextResponse.json({ success: true })
}
