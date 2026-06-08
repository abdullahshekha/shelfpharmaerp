import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      retailer: true,
      order: {
        include: {
          items: { include: { medicine: { select: { name: true, code: true, category: true } } } },
          salesRep: { select: { name: true } },
        },
      },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  })

  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: invoice })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      status: body.status,
      notes: body.notes ?? undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    },
  })

  return NextResponse.json({ data: invoice })
}
