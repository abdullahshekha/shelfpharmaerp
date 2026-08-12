import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleDelete } from '@/lib/utils/delete-approval'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const retailer = await prisma.retailer.findUnique({
    where: { id },
    include: {
      salesRep: { select: { id: true, name: true } },
      area: { select: { id: true, name: true } },
      drugLicenses: { orderBy: { createdAt: 'asc' } },
      orders: {
        orderBy: { orderDate: 'desc' },
        take: 10,
        include: { _count: { select: { items: true } } },
      },
      invoices: {
        orderBy: { invoiceDate: 'desc' },
        take: 10,
        select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true, status: true },
      },
    },
  })

  if (!retailer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const user = getUserFromRequest(req)
  if (user.role === 'SALES_REP' && retailer.salesRepId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const outstanding = await prisma.invoice.aggregate({
    where: { retailerId: id, status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
    _sum: { totalAmount: true },
  })

  return NextResponse.json({ data: { ...retailer, outstandingBalance: outstanding._sum.totalAmount ?? 0 } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (getUserFromRequest(req).role === 'SALES_REP') {
    return NextResponse.json({ error: 'Order Booker cannot edit customers' }, { status: 403 })
  }
  const body = await req.json()
  const paymentMode = body.paymentMode ?? 'CASH'

  const isFiler = !!body.isFiler
  if (isFiler && !body.ntnNumber?.trim()) {
    return NextResponse.json({ error: 'NTN Number is required for a Filer customer' }, { status: 400 })
  }
  if (isFiler && body.strnStatus === 'REGISTERED' && !body.strnNumber?.trim()) {
    return NextResponse.json({ error: 'STRN Number is required when STRN is Registered' }, { status: 400 })
  }

  const drugLicenses = ((body.drugLicenses ?? []) as { licenseNumber: string; formNumber?: string; expiryDate?: string }[])
    .filter((l) => l.licenseNumber?.trim())
    .map((l) => ({
      licenseNumber: l.licenseNumber.trim(),
      formNumber: l.formNumber?.trim() || null,
      expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
    }))

  const retailer = await prisma.$transaction(async (tx) => {
    const updated = await tx.retailer.update({
      where: { id },
      data: {
        name: body.name,
        ownerName: body.ownerName ?? null,
        phone: body.phone ?? null,
        whatsappNumber: body.whatsappNumber ?? null,
        areaId: body.areaId ?? null,
        address: body.address ?? null,
        customerType: body.customerType ?? null,
        drapRegistered: body.drapRegistered ?? false,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        storePhotoUrl: body.storePhotoUrl ?? null,
        isFiler,
        ntnNumber: isFiler ? (body.ntnNumber?.trim() ?? null) : null,
        strnStatus: isFiler ? (body.strnStatus ?? null) : null,
        strnNumber: isFiler && body.strnStatus === 'REGISTERED' ? (body.strnNumber?.trim() ?? null) : null,
        creditLimit: paymentMode === 'CHEQUE' ? (body.creditLimit ?? 0) : 0,
        creditDays: paymentMode === 'CHEQUE' ? (body.creditDays ?? 0) : 0,
        paymentMode,
        salesRepId: body.salesRepId ?? null,
        notes: body.notes ?? null,
        isActive: body.isActive ?? true,
      },
    })

    // Full replace — simplest correct approach for a small, staff-curated list
    if (body.drugLicenses !== undefined) {
      await tx.drugLicense.deleteMany({ where: { retailerId: id } })
      if (drugLicenses.length > 0) {
        await tx.drugLicense.createMany({ data: drugLicenses.map((l) => ({ ...l, retailerId: id })) })
      }
    }

    return updated
  })

  return NextResponse.json({ data: retailer })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const retailer = await prisma.retailer.findUnique({ where: { id }, select: { name: true } })
  if (!retailer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return handleDelete(req, 'Retailer', id, retailer.name, async () => {
    await prisma.retailer.update({ where: { id }, data: { isActive: false } })
  })
}
