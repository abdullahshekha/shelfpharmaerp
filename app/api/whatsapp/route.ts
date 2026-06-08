import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const orders = await prisma.whatsappOrder.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      retailer: { select: { name: true } },
    },
    take: 50,
  })
  return NextResponse.json({ data: orders })
}
