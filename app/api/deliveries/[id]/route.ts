import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncSafe } from '@/lib/accounting/sync'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  // Never overwrite an existing deliveredAt (re-marking DELIVERED must not move the COGS posting date).
  const prior = body.status === 'DELIVERED' ? await prisma.delivery.findUnique({ where: { id }, select: { deliveredAt: true } }) : null
  const delivery = await prisma.delivery.update({
    where: { id },
    data: {
      status: body.status ?? undefined,
      driverId: body.driverId !== undefined ? (body.driverId || null) : undefined,
      deliveredAt: body.status === 'DELIVERED' && !prior?.deliveredAt ? new Date() : undefined,
      notes: body.notes !== undefined ? body.notes : undefined,
    },
  })

  await syncSafe('DELIVERY_COGS', delivery.orderId)

  return NextResponse.json({ data: delivery })
}
