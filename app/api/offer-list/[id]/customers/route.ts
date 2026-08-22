import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const customers = await prisma.offerListCustomer.findMany({
    where: { offerListId: id },
    include: {
      retailer: { select: { id: true, name: true, phone: true } },
      _count: { select: { items: true } },
      items: { select: { quantity: true } },
    },
    orderBy: { retailer: { name: 'asc' } },
  })

  const data = customers.map((c) => ({
    id: c.id,
    retailer: c.retailer,
    itemCount: c._count.items,
    filledCount: c.items.filter((i) => i.quantity > 0).length,
  }))

  return NextResponse.json({ data })
}

// Assigns this offer list to one specific customer regardless of Customer Type — an individual
// override on top of the type-based assignment in /api/offer-list/[id]/assign. Seeds the sheet
// with every medicine currently on the list at qty 0, same as the bulk type-based path.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const retailerId: string | undefined = body.retailerId
  if (!retailerId) return NextResponse.json({ error: 'retailerId required' }, { status: 400 })

  const list = await prisma.offerList.findUnique({ where: { id }, include: { items: true } })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const retailer = await prisma.retailer.findUnique({ where: { id: retailerId }, select: { id: true } })
  if (!retailer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const sheet = await prisma.offerListCustomer.upsert({
    where: { offerListId_retailerId: { offerListId: id, retailerId } },
    update: {},
    create: { offerListId: id, retailerId },
  })

  if (list.items.length > 0) {
    await prisma.offerListCustomerItem.createMany({
      data: list.items.map((item) => ({
        offerListCustomerId: sheet.id,
        medicineId: item.medicineId,
        quantity: 0,
      })),
      skipDuplicates: true,
    })
  }

  return NextResponse.json({ data: { id: sheet.id } })
}
