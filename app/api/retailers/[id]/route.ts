import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleDelete } from '@/lib/utils/delete-approval'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const retailer = await prisma.retailer.findUnique({
    where: { id },
    include: {
      salesRep: { select: { id: true, name: true } },
      area: { select: { id: true, name: true } },
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

  const outstanding = await prisma.invoice.aggregate({
    where: { retailerId: id, status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
    _sum: { totalAmount: true },
  })

  return NextResponse.json({ data: { ...retailer, outstandingBalance: outstanding._sum.totalAmount ?? 0 } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const paymentMode = body.paymentMode ?? 'CASH'

  const retailer = await prisma.retailer.update({
    where: { id },
    data: {
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
      isActive: body.isActive ?? true,
    },
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
