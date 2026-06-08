import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const type = searchParams.get('type') ?? ''

  const suppliers = await prisma.supplier.findMany({
    where: {
      isActive: true,
      ...(search && { name: { contains: search } }),
      ...(type && { type }),
    },
    include: { _count: { select: { purchaseInvoices: true } } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ data: suppliers })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  if (!['OPEN_MARKET', 'OFFICIAL_DISTRIBUTOR'].includes(body.type)) {
    return NextResponse.json({ error: 'Type must be OPEN_MARKET or OFFICIAL_DISTRIBUTOR' }, { status: 400 })
  }
  const supplier = await prisma.supplier.create({
    data: {
      name: body.name.trim(),
      type: body.type,
      contactPerson: body.contactPerson ?? null,
      phone: body.phone ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
    },
  })
  return NextResponse.json({ data: supplier }, { status: 201 })
}
