import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20')
  const search = searchParams.get('search') ?? ''
  const manufacturer = searchParams.get('manufacturer') ?? ''
  const category = searchParams.get('category') ?? ''
  const lowStock = searchParams.get('lowStock') === 'true'
  const nearExpiry = searchParams.get('nearExpiry') === 'true'

  const where: Prisma.MedicineWhereInput = {
    isActive: true,
    ...(search && {
      OR: [
        { name: { contains: search } },
        { code: { contains: search } },
        { manufacturer: { name: { contains: search } } },
      ],
    }),
    ...(manufacturer && { manufacturer: { name: { contains: manufacturer } } }),
    ...(category && { category }),
  }

  const [medicines, total] = await Promise.all([
    prisma.medicine.findMany({
      where,
      include: {
        manufacturer: { select: { name: true } },
        batches: {
          select: { currentQty: true, expiryDate: true },
          orderBy: { expiryDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.medicine.count({ where }),
  ])

  const now = new Date()
  const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

  let results = medicines.map((m) => {
    const totalStock = m.batches.reduce((sum, b) => sum + b.currentQty, 0)
    const hasNearExpiry = m.batches.some((b) => b.expiryDate <= ninetyDays && b.currentQty > 0)
    return { ...m, totalStock, hasNearExpiry }
  })

  if (lowStock) results = results.filter((m) => m.totalStock <= m.minStockLevel)
  if (nearExpiry) results = results.filter((m) => m.hasNearExpiry)

  return NextResponse.json({
    data: results,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const medicine = await prisma.medicine.create({
    data: {
      code: body.code,
      name: body.name,
      genericName: body.genericName ?? null,
      manufacturerId: body.manufacturerId,
      category: body.category ?? null,
      packSize: body.packSize ?? null,
      tradePrice: body.tradePrice,
      mrp: body.mrp ?? null,
      minStockLevel: body.minStockLevel ?? 10,
    },
    include: { manufacturer: { select: { name: true } } },
  })

  return NextResponse.json({ data: medicine }, { status: 201 })
}
