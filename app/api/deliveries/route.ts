import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? ''
  const date   = searchParams.get('date')   ?? ''   // legacy single-date
  const from   = searchParams.get('from')   ?? ''
  const to     = searchParams.get('to')     ?? ''
  const user   = getUserFromRequest(req)

  const where: Prisma.DeliveryWhereInput = {
    // Salesman only ever sees deliveries assigned to them, regardless of any other filter
    ...(user.role === 'SALESMAN' && { driverId: user.id }),
    ...(status && { status }),
    ...(date && !from && {
      scheduledDate: {
        gte: new Date(date),
        lt:  new Date(new Date(date).getTime() + 86400000),
      },
    }),
    ...((from || to) && {
      scheduledDate: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lt:  new Date(new Date(to).getTime() + 86400000) }),
      },
    }),
  }

  const deliveries = await prisma.delivery.findMany({
    where,
    include: {
      order: {
        include: {
          retailer: {
            select: {
              name: true,
              address: true,
              phone: true,
              area: { select: { name: true } },
            },
          },
        },
      },
      driver: { select: { name: true } },
    },
    orderBy: { scheduledDate: 'asc' },
  })

  return NextResponse.json({ data: deliveries })
}
