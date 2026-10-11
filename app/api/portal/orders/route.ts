import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPortalCustomerFromRequest } from '@/lib/portal/session'
import { orderViewInclude, serializeOrder } from '@/lib/portal/order'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orders = await prisma.order.findMany({
    where: { retailerId: customer.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: orderViewInclude,
  })
  return NextResponse.json({ data: orders.map(serializeOrder) })
}
