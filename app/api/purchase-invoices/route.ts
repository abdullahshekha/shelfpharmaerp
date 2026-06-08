import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const supplierId = searchParams.get('supplierId') ?? ''
  const status     = searchParams.get('status')     ?? ''
  const from       = searchParams.get('from')       ?? ''
  const to         = searchParams.get('to')         ?? ''
  const page       = parseInt(searchParams.get('page')     ?? '1')
  const pageSize   = parseInt(searchParams.get('pageSize') ?? '20')

  const where = {
    ...(supplierId && { supplierId }),
    ...(status     && { status }),
    ...((from || to) && {
      invoiceDate: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lt:  new Date(new Date(to).getTime() + 86400000) }),
      },
    }),
  }

  const [invoices, total] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where,
      include: {
        supplier: { select: { name: true, type: true } },
        _count: { select: { items: true } },
      },
      orderBy: { invoiceDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchaseInvoice.count({ where }),
  ])

  return NextResponse.json({ data: invoices, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  if (!body.supplierId) return NextResponse.json({ error: 'Supplier required' }, { status: 400 })
  if (!body.items?.length) return NextResponse.json({ error: 'At least one item required' }, { status: 400 })

  const invoiceNumber = `SP-PUR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')}`

  const totalAmount = body.items.reduce(
    (sum: number, item: { quantity: number; unitPrice: number }) => sum + item.quantity * item.unitPrice,
    0
  )

  const invoice = await prisma.purchaseInvoice.create({
    data: {
      invoiceNumber,
      supplierId: body.supplierId,
      invoiceDate: new Date(body.invoiceDate ?? new Date()),
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      totalAmount,
      status: 'UNPAID',
      notes: body.notes ?? null,
      items: {
        create: body.items.map((item: { medicineId: string; quantity: number; unitPrice: number }) => ({
          medicineId: item.medicineId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.quantity * item.unitPrice,
        })),
      },
    },
    include: { items: true },
  })

  return NextResponse.json({ data: invoice }, { status: 201 })
}
