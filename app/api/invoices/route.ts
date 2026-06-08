import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20')
  const status     = searchParams.get('status')     ?? ''
  const retailerId = searchParams.get('retailerId') ?? ''
  const from       = searchParams.get('from')       ?? ''
  const to         = searchParams.get('to')         ?? ''

  const where: Prisma.InvoiceWhereInput = {
    ...(status     && { status }),
    ...(retailerId && { retailerId }),
    ...((from || to) && {
      invoiceDate: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lt:  new Date(new Date(to).getTime() + 86400000) }),
      },
    }),
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        retailer: { select: { name: true, area: { select: { name: true } } } },
        order: { select: { orderNumber: true } },
      },
      orderBy: { invoiceDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invoice.count({ where }),
  ])

  return NextResponse.json({
    data: invoices,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
}
