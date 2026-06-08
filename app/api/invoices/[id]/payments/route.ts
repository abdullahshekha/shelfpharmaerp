import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  if (!body.amount || Number(body.amount) <= 0) {
    return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 })
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        retailerId: invoice.retailerId,
        invoiceId: id,
        amount: Number(body.amount),
        method: body.method ?? 'CASH',
        reference: body.reference ?? null,
        notes: body.notes ?? null,
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
      },
    })

    // Recalculate invoice status
    const allPayments = [...invoice.payments, payment]
    const totalPaid = allPayments.reduce((s, p) => s + Number(p.amount), 0)
    const invoiceTotal = Number(invoice.totalAmount)

    const newStatus = totalPaid >= invoiceTotal ? 'PAID'
      : totalPaid > 0 ? 'PARTIAL'
      : 'UNPAID'

    await tx.invoice.update({ where: { id }, data: { status: newStatus } })

    return { payment, newStatus, totalPaid }
  })

  return NextResponse.json({ data: result }, { status: 201 })
}
