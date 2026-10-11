import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateInvoiceNumber, generateChallanNumber, getNextDeliveryDateForArea } from '@/lib/utils/format'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { status } = await req.json()

  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: { status },
      include: {
        items: { include: { medicine: true } },
        retailer: { include: { area: { select: { deliveryDays: true } } } },
      },
    })

    if (status === 'CONFIRMED') {
      const existing = await tx.invoice.findUnique({ where: { orderId: id } })
      if (!existing) {
        const subtotal = Number(updated.totalAmount)
        const discount = Number(updated.discountAmount)
        const taxAmount = updated.items.reduce((sum, i) => sum + Number(i.salesTaxAmount), 0)
        const total = subtotal - discount + taxAmount

        const dueDate = new Date()
        dueDate.setDate(dueDate.getDate() + (updated.retailer.creditDays ?? 0))

        await tx.invoice.create({
          data: {
            invoiceNumber: generateInvoiceNumber(),
            orderId: id,
            retailerId: updated.retailerId,
            subtotal,
            discountAmount: discount,
            taxAmount,
            totalAmount: total,
            dueDate,
          },
        })
      }

      const existingDelivery = await tx.delivery.findUnique({ where: { orderId: id } })
      if (!existingDelivery) {
        await tx.delivery.create({
          data: {
            orderId: id,
            scheduledDate: getNextDeliveryDateForArea(updated.retailer.area?.deliveryDays),
          },
        })
      }

      const existingChallan = await tx.deliveryChallan.findUnique({ where: { orderId: id } })
      if (!existingChallan) {
        await tx.deliveryChallan.create({ data: { orderId: id, challanNumber: generateChallanNumber() } })
      }
    }

    if (status === 'DELIVERED') {
      for (const item of updated.items) {
        let remaining = item.quantity
        const batches = await tx.medicineBatch.findMany({
          where: { medicineId: item.medicineId, currentQty: { gt: 0 } },
          orderBy: { expiryDate: 'asc' },
        })

        for (const batch of batches) {
          if (remaining <= 0) break
          const deduct = Math.min(batch.currentQty, remaining)
          await tx.medicineBatch.update({
            where: { id: batch.id },
            data: { currentQty: batch.currentQty - deduct },
          })
          remaining -= deduct
        }
      }

      await tx.delivery.updateMany({
        where: { orderId: id },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      })
    }

    return updated
  })

  return NextResponse.json({ data: order })
}
