import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncSafe } from '@/lib/accounting/sync'
import { getUserFromRequest } from '@/lib/utils/auth'
import { createChequeRecord, ChequeError } from '@/lib/pdc/create'
import { chequeInputFromPayment, normalizePaymentMethod, PaymentChequeError } from '@/lib/pdc/from-payment'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const method = normalizePaymentMethod(body.method)

  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: { payments: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A cheque is recorded as Pending (no payment, no status change) and applied when cleared.
  if (method === 'CHEQUE') {
    const user = getUserFromRequest(req)
    try {
      const cheque = await createChequeRecord(user, chequeInputFromPayment(body, invoice, 'PAYABLE'))
      return NextResponse.json({ data: { cheque }, pending: true }, { status: 201 })
    } catch (e) {
      if (e instanceof ChequeError || e instanceof PaymentChequeError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      throw e
    }
  }

  let out
  try {
  out = await prisma.$transaction(
    async (tx) => {
      // Same per-party lock as cheque clearing, so a manual payment and a clearing cannot over-pay.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'PDC_PARTY:' + invoice.supplierId}))`

      const payment = await tx.supplierPayment.create({
        data: {
          purchaseInvoiceId: id,
          supplierId: invoice.supplierId,
          amount: body.amount,
          paymentDate: new Date(body.paymentDate ?? new Date()),
          method,
          reference: body.reference ?? null,
          notes: body.notes ?? null,
        },
      })

      // Recalculate status from payments read inside the lock (includes the new one)
      const allPayments = await tx.supplierPayment.findMany({ where: { purchaseInvoiceId: id }, select: { amount: true } })
      const totalPaid = allPayments.reduce((s, p) => s + Number(p.amount), 0)
      const total = Number(invoice.totalAmount)
      const newStatus = totalPaid >= total ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID'

      await tx.purchaseInvoice.update({ where: { id }, data: { status: newStatus } })
      return { payment, newStatus }
    },
    { maxWait: 10000, timeout: 15000 },
  )
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2028') {
      return NextResponse.json({ error: 'The server is busy, please retry' }, { status: 503 })
    }
    throw e
  }
  const { payment, newStatus } = out

  await syncSafe('SUPPLIER_PAYMENT', payment.id)

  return NextResponse.json({ data: payment, newStatus }, { status: 201 })
}
