import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      purchaseInvoices: {
        orderBy: { invoiceDate: 'desc' },
        include: {
          items: { include: { medicine: { select: { name: true, code: true } } } },
          payments: true,
          _count: { select: { items: true } },
        },
      },
      supplierReturns: {
        orderBy: { returnDate: 'desc' },
        include: { items: { include: { medicine: { select: { name: true, code: true } } } } },
      },
    },
  })
  if (!supplier) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: supplier })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const isFiler = !!body.isFiler
  if (isFiler && !body.ntnNumber?.trim()) {
    return NextResponse.json({ error: 'NTN Number is required for a Filer supplier' }, { status: 400 })
  }
  if (isFiler && body.strnStatus === 'REGISTERED' && !body.strnNumber?.trim()) {
    return NextResponse.json({ error: 'STRN Number is required when STRN is Registered' }, { status: 400 })
  }

  const supplier = await prisma.supplier.update({
    where: { id },
    data: {
      name: body.name,
      type: body.type,
      contactPerson: body.contactPerson ?? null,
      phone: body.phone ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
      isFiler,
      ntnNumber: isFiler ? (body.ntnNumber?.trim() ?? null) : null,
      strnStatus: isFiler ? (body.strnStatus ?? null) : null,
      strnNumber: isFiler && body.strnStatus === 'REGISTERED' ? (body.strnNumber?.trim() ?? null) : null,
      drugLicenseNumber: body.drugLicenseNumber?.trim() || null,
      isActive: body.isActive ?? true,
    },
  })
  return NextResponse.json({ data: supplier })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.supplier.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ success: true })
}
