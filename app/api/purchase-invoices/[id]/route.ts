import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { medicine: { select: { name: true, code: true, category: true } } } },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: invoice })
}
