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
