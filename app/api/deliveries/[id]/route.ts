import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const delivery = await prisma.delivery.update({
    where: { id },
    data: {
      status: body.status ?? undefined,
      driverId: body.driverId !== undefined ? (body.driverId || null) : undefined,
      deliveredAt: body.status === 'DELIVERED' ? new Date() : undefined,
      notes: body.notes !== undefined ? body.notes : undefined,
    },
  })

  return NextResponse.json({ data: delivery })
}
