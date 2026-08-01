import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20')
  const search = searchParams.get('search') ?? ''
  const areaId = searchParams.get('areaId') ?? ''
  const salesRepId = searchParams.get('salesRepId') ?? ''
  const user = getUserFromRequest(req)

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
    // Order Booker only ever sees their own customers, regardless of any client-supplied filter
    ...(user.role === 'SALES_REP' ? { salesRepId: user.id } : (salesRepId && { salesRepId })),
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
  const user = getUserFromRequest(req)
  if (!body.name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const paymentMode = body.paymentMode ?? 'CASH'
  const isFiler = !!body.isFiler
  if (isFiler && !body.ntnNumber?.trim()) {
    return NextResponse.json({ error: 'NTN Number is required for a Filer customer' }, { status: 400 })
  }
  if (isFiler && body.strnStatus === 'REGISTERED' && !body.strnNumber?.trim()) {
    return NextResponse.json({ error: 'STRN Number is required when STRN is Registered' }, { status: 400 })
  }

  const retailer = await prisma.retailer.create({
    data: {
      code: body.code ?? null,
      name: body.name,
      ownerName: body.ownerName ?? null,
      phone: body.phone ?? null,
      whatsappNumber: body.whatsappNumber ?? null,
      areaId: body.areaId ?? null,
      address: body.address ?? null,
      customerType: body.customerType ?? null,
      drugLicenseNumber: body.drugLicenseNumber ?? null,
      drugLicenseExpiry: body.drugLicenseExpiry ? new Date(body.drugLicenseExpiry) : null,
      isFiler,
      ntnNumber: isFiler ? (body.ntnNumber?.trim() ?? null) : null,
      strnStatus: isFiler ? (body.strnStatus ?? null) : null,
      strnNumber: isFiler && body.strnStatus === 'REGISTERED' ? (body.strnNumber?.trim() ?? null) : null,
      creditLimit: paymentMode === 'CHEQUE' ? (body.creditLimit ?? 0) : 0,
      creditDays: paymentMode === 'CHEQUE' ? (body.creditDays ?? 0) : 0,
      paymentMode,
      // Order Booker can only ever assign a new customer to themselves, never another Order Booker
      salesRepId: user.role === 'SALES_REP' ? user.id : (body.salesRepId ?? null),
      notes: body.notes ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      storePhotoUrl: body.storePhotoUrl ?? null,
      drapRegistered: !!body.drapRegistered,
    },
  })

  return NextResponse.json({ data: retailer }, { status: 201 })
}
