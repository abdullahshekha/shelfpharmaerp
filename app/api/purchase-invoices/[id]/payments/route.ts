import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: { payments: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const payment = await prisma.supplierPayment.create({
    data: {
      purchaseInvoiceId: id,
      supplierId: invoice.supplierId,
      amount: body.amount,
      paymentDate: new Date(body.paymentDate ?? new Date()),
      method: body.method ?? 'CASH',
      reference: body.reference ?? null,
      notes: body.notes ?? null,
    },
  })

  // Recalculate status
  const allPayments = [...invoice.payments, payment]
  const totalPaid = allPayments.reduce((s, p) => s + Number(p.amount), 0)
  const total = Number(invoice.totalAmount)
  const newStatus = totalPaid >= total ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID'

  await prisma.purchaseInvoice.update({ where: { id }, data: { status: newStatus } })

  return NextResponse.json({ data: payment, newStatus }, { status: 201 })
}
