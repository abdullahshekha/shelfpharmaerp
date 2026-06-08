import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      retailer: true,
      salesRep: { select: { name: true } },
      items: { include: { medicine: { select: { name: true, code: true, category: true } } } },
      invoice: true,
      delivery: { include: { driver: { select: { name: true } } } },
      whatsappOrder: { select: { imageUrl: true } },
    },
  })

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: order })
}

// ?hard=true → permanently deletes the order and its linked delivery/invoice
// default  → soft cancel (status = CANCELLED)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const hard = new URL(req.url).searchParams.get('hard') === 'true'

  if (!hard) {
    await prisma.order.update({ where: { id }, data: { status: 'CANCELLED' } })
    return NextResponse.json({ success: true })
  }

  // Hard delete — clean up related records first
  await prisma.$transaction(async (tx) => {
    // Remove delivery
    await tx.delivery.deleteMany({ where: { orderId: id } })

    // Void invoice (delete payments first, then invoice)
    const invoice = await tx.invoice.findUnique({ where: { orderId: id } })
    if (invoice) {
      await tx.payment.deleteMany({ where: { invoiceId: invoice.id } })
      await tx.invoice.delete({ where: { id: invoice.id } })
    }

    // Delete order (cascades to order items via Prisma schema)
    await tx.order.delete({ where: { id } })
  })

  return NextResponse.json({ success: true })
}
