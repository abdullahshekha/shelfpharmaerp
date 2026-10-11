import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

// Cross-supplier list of purchase returns (creation stays per-supplier: POST /api/suppliers/[id]/returns)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20')
  const supplierId = searchParams.get('supplierId') ?? ''
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  const where: Prisma.SupplierReturnWhereInput = {
    ...(supplierId && { supplierId }),
    ...((from || to) && {
      returnDate: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lt: new Date(new Date(to).getTime() + 86400000) }),
      },
    }),
  }

  const [returns, total] = await Promise.all([
    prisma.supplierReturn.findMany({
      where,
      include: {
        supplier: { select: { name: true } },
        items: { include: { medicine: { select: { name: true } }, batch: { select: { batchNumber: true } } } },
      },
      orderBy: { returnDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplierReturn.count({ where }),
  ])

  return NextResponse.json({
    data: returns,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}
