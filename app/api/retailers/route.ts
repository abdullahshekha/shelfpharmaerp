import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20')
  const search = searchParams.get('search') ?? ''
  const areaId = searchParams.get('areaId') ?? ''
  const salesRepId = searchParams.get('salesRepId') ?? ''

  const where: Prisma.RetailerWhereInput = {
    isActive: true,
    ...(search && {
      OR: [
        { name: { contains: search } },
        { phone: { contains: search } },
        { ownerName: { contains: search } },
      ],
    }),
    ...(areaId && { areaId }),
    ...(salesRepId && { salesRepId }),
  }

  const [retailers, total] = await Promise.all([
    prisma.retailer.findMany({
      where,
      include: {
        salesRep: { select: { name: true } },
        area: { select: { name: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.retailer.count({ where }),
  ])

  return NextResponse.json({
    data: retailers,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const paymentMode = body.paymentMode ?? 'CASH'

  const retailer = await prisma.retailer.create({
    data: {
      code: body.code ?? null,
      name: body.name,
      ownerName: body.ownerName ?? null,
      phone: body.phone ?? null,
      whatsappNumber: body.whatsappNumber ?? null,
      areaId: body.areaId ?? null,
      address: body.address ?? null,
      drugLicenseNumber: body.drugLicenseNumber ?? null,
      drugLicenseExpiry: body.drugLicenseExpiry ? new Date(body.drugLicenseExpiry) : null,
      creditLimit: paymentMode === 'CHEQUE' ? (body.creditLimit ?? 0) : 0,
      creditDays: paymentMode === 'CHEQUE' ? (body.creditDays ?? 0) : 0,
      paymentMode,
      salesRepId: body.salesRepId ?? null,
      notes: body.notes ?? null,
    },
  })

  return NextResponse.json({ data: retailer }, { status: 201 })
}
