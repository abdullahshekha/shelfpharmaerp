import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getEffectivePrice } from '@/lib/utils/pricing'
import { generateMedicineCode } from '@/lib/utils/generate-code'

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
  const sort = searchParams.get('sort') ?? '' // tp_asc | tp_desc | stock_asc | stock_desc

  const where: Prisma.MedicineWhereInput = {
    isActive: true,
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { genericName: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { manufacturer: { name: { contains: search, mode: 'insensitive' } } },
      ],
    }),
    ...(manufacturer && { manufacturer: { name: { contains: manufacturer, mode: 'insensitive' } } }),
    ...(category && { category }),
  }

  // T.P. and stock are derived from batches, and Low Stock / Near Expiry depend on them too, so
  // none of these can be applied in the DB query. When any is active, load every match, filter/sort
  // in memory, then paginate — otherwise they'd only apply within the current page.
  const inMemory = !!sort || lowStock || nearExpiry

  const medicines = await prisma.medicine.findMany({
    where,
    include: {
      manufacturer: { select: { name: true } },
      batches: {
        select: { currentQty: true, expiryDate: true, tradePrice: true, mrp: true },
        orderBy: { expiryDate: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
    ...(inMemory ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
  })
  const dbTotal = inMemory ? medicines.length : await prisma.medicine.count({ where })

  const now = new Date()
  const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

  let results = medicines.map((m) => {
    const totalStock = m.batches.reduce((sum, b) => sum + b.currentQty, 0)
    const hasNearExpiry = m.batches.some((b) => b.expiryDate <= ninetyDays && b.currentQty > 0)
    const { tradePrice, mrp } = getEffectivePrice(m.batches)
    return { ...m, totalStock, hasNearExpiry, tradePrice, mrp }
  })

  if (lowStock) results = results.filter((m) => m.totalStock <= m.minStockLevel)
  if (nearExpiry) results = results.filter((m) => m.hasNearExpiry)

  const dir = sort.endsWith('_desc') ? -1 : 1
  if (sort.startsWith('stock_')) {
    results.sort((a, b) => (a.totalStock - b.totalStock) * dir)
  } else if (sort.startsWith('tp_')) {
    // Medicines with no priced batch always sink to the bottom, in either direction
    results.sort((a, b) => {
      if (a.tradePrice == null && b.tradePrice == null) return 0
      if (a.tradePrice == null) return 1
      if (b.tradePrice == null) return -1
      return (Number(a.tradePrice) - Number(b.tradePrice)) * dir
    })
  }

  const total = inMemory ? results.length : dbTotal
  if (inMemory) results = results.slice((page - 1) * pageSize, page * pageSize)

  return NextResponse.json({
    data: results,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const code = await generateMedicineCode()

  const medicine = await prisma.medicine.create({
    data: {
      code,
      name: body.name,
      genericName: body.genericName ?? null,
      manufacturerId: body.manufacturerId,
      category: body.category ?? null,
      packSize: body.packSize ?? null,
      salesTaxApplicable: body.salesTaxApplicable ?? false,
      minStockLevel: body.minStockLevel ?? 10,
    },
    include: { manufacturer: { select: { name: true } } },
  })

  return NextResponse.json({ data: medicine }, { status: 201 })
}
