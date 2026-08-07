import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getEffectivePrice } from '@/lib/utils/pricing'
import { handleDelete } from '@/lib/utils/delete-approval'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const medicine = await prisma.medicine.findUnique({
    where: { id },
    include: {
      manufacturer: true,
      batches: { orderBy: { expiryDate: 'asc' } },
    },
  })
  if (!medicine) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { tradePrice, mrp } = getEffectivePrice(medicine.batches)
  return NextResponse.json({ data: { ...medicine, tradePrice, mrp } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const medicine = await prisma.medicine.update({
    where: { id },
    data: {
      name: body.name,
      genericName: body.genericName ?? null,
      manufacturerId: body.manufacturerId,
      category: body.category ?? null,
      packSize: body.packSize ?? null,
      salesTaxApplicable: body.salesTaxApplicable ?? false,
      minStockLevel: body.minStockLevel ?? 10,
      isActive: body.isActive ?? true,
    },
  })

  return NextResponse.json({ data: medicine })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const medicine = await prisma.medicine.findUnique({ where: { id }, select: { name: true } })
  if (!medicine) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return handleDelete(req, 'Medicine', id, medicine.name, async () => {
    await prisma.medicine.update({ where: { id }, data: { isActive: false } })
  })
}
