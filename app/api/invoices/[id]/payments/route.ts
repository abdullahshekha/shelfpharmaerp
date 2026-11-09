import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncSafe } from '@/lib/accounting/sync'
import { getUserFromRequest } from '@/lib/utils/auth'
import { createChequeRecord, ChequeError } from '@/lib/pdc/create'
import { chequeInputFromPayment, PaymentChequeError } from '@/lib/pdc/from-payment'

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

  // A cheque is recorded as Pending (no payment, no status change) and applied when cleared.
  if (body.method === 'CHEQUE') {
    const user = getUserFromRequest(req)
    try {
      const cheque = await createChequeRecord(user, chequeInputFromPayment(body, invoice, 'RECEIVABLE'))
      return NextResponse.json({ data: { cheque }, pending: true }, { status: 201 })
    } catch (e) {
      if (e instanceof ChequeError || e instanceof PaymentChequeError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      throw e
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Same per-party lock as cheque clearing, so a manual payment and a clearing cannot over-pay.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'PDC_PARTY:' + invoice.retailerId}))`

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

    // Recalculate invoice status from payments read inside the lock (includes the new one)
    const allPayments = await tx.payment.findMany({ where: { invoiceId: id }, select: { amount: true } })
    const totalPaid = allPayments.reduce((s, p) => s + Number(p.amount), 0)
    const invoiceTotal = Number(invoice.totalAmount)

    const newStatus = totalPaid >= invoiceTotal ? 'PAID'
      : totalPaid > 0 ? 'PARTIAL'
      : 'UNPAID'

    await tx.invoice.update({ where: { id }, data: { status: newStatus } })

    return { payment, newStatus, totalPaid }
  })

  await syncSafe('PAYMENT', result.payment.id)

  return NextResponse.json({ data: result }, { status: 201 })
}
