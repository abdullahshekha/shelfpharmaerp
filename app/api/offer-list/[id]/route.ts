import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const list = await prisma.offerList.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          medicine: {
            include: {
              manufacturer: { select: { name: true } },
              batches: { select: { currentQty: true } },
            },
          },
        },
        orderBy: { medicine: { name: 'asc' } },
      },
      assignments: { select: { customerType: true } },
      _count: { select: { customers: true } },
    },
  })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: list })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  return await prisma.$transaction(async (tx) => {
    // Activating this list — deactivate all others first
    if (body.isActive === true) {
      await tx.offerList.updateMany({ where: { isActive: true }, data: { isActive: false } })
    }

    const list = await tx.offerList.update({
      where: { id },
      data: {
        name: body.name !== undefined ? (body.name?.trim() || null) : undefined,
        isActive: body.isActive ?? undefined,
        listDate: body.listDate ? new Date(body.listDate) : undefined,
      },
    })

    // Upsert items if provided
    if (body.items && Array.isArray(body.items)) {
      for (const item of body.items) {
        await tx.offerListItem.upsert({
          where: { offerListId_medicineId: { offerListId: id, medicineId: item.medicineId } },
          update: {
            offerPercent: item.offerPercent ?? 0,
            bonusQty: item.bonusQty ?? 0,
            specialPrice: item.specialPrice ?? null,
            salesTax: item.salesTax ?? 0,
          },
          create: {
            offerListId: id,
            medicineId: item.medicineId,
            offerPercent: item.offerPercent ?? 0,
            bonusQty: item.bonusQty ?? 0,
            specialPrice: item.specialPrice ?? null,
            salesTax: item.salesTax ?? 0,
          },
        })
      }
    }

    return NextResponse.json({ data: list })
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.offerList.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
