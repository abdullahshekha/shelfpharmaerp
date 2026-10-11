import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleDelete } from '@/lib/utils/delete-approval'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      retailer: true,
      salesRep: { select: { name: true } },
      items: { include: { medicine: { select: { name: true, code: true, category: true, salesTaxApplicable: true } } } },
      invoice: true,
      delivery: { include: { driver: { select: { name: true } } } },
      whatsappOrder: { select: { imageUrl: true } },
    },
  })

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: order })
}

interface EditItemInput {
  id: string // existing OrderItem.id — editing existing lines only, no add/remove
  quantity: number
  mrp?: number | null
  unitPrice: number
  offerPercent?: number
  salesTax?: number
  bonusQty?: number
}

// Admin-only edit of an already-created Sales Invoice (Order). Recomputes each line and the
// order/invoice totals with the same formulas as creation/confirmation. If the order is already
// DELIVERED, stock was deducted FEFO with no per-line record of which batch(es) supplied it (see
// CLAUDE.md's Sales Invoice section), so a quantity change there is applied as a best-effort delta:
// an increase deducts the extra via FEFO same as a normal delivery; a decrease restocks onto
// whichever batch is currently earliest-expiring for that medicine. This is an approximation, not
// an exact reversal of the original deduction — there is no data that would allow an exact one.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Only an Admin can edit a Sales Invoice' }, { status: 403 })
  }

  const body = await req.json()
  const editItems: EditItemInput[] = body.items ?? []

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, invoice: true, retailer: { select: { creditDays: true } } },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existingById = new Map(order.items.map((i) => [i.id, i]))
  if (editItems.length !== order.items.length || editItems.some((i) => !existingById.has(i.id))) {
    return NextResponse.json({ error: 'Adding or removing items is not supported — edit existing lines only' }, { status: 400 })
  }

  const medicines = await prisma.medicine.findMany({
    where: { id: { in: order.items.map((i) => i.medicineId) } },
    select: { id: true, name: true, salesTaxApplicable: true },
  })
  const medicineMap = new Map(medicines.map((m) => [m.id, m]))
  const warnings: string[] = []

  const result = await prisma.$transaction(async (tx) => {
    const computed = editItems.map((item) => {
      const existing = existingById.get(item.id)!
      const medicine = medicineMap.get(existing.medicineId)
      const offerPercent = item.offerPercent ?? 0
      const salesTax = medicine?.salesTaxApplicable ? (item.salesTax ?? 0) : 0
      const salesTaxAmount = salesTax * item.quantity
      const lineTotal = item.quantity * item.unitPrice * (1 - offerPercent / 100)
      return {
        existing,
        medicineId: existing.medicineId,
        quantity: item.quantity,
        mrp: item.mrp ?? null,
        unitPrice: item.unitPrice,
        offerPercent,
        salesTax,
        salesTaxAmount,
        bonusQty: item.bonusQty ?? 0,
        lineTotal,
      }
    })

    if (order.status === 'DELIVERED') {
      for (const item of computed) {
        const delta = item.quantity - item.existing.quantity
        if (delta === 0) continue

        if (delta > 0) {
          let remaining = delta
          const batches = await tx.medicineBatch.findMany({
            where: { medicineId: item.medicineId, currentQty: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
          })
          for (const batch of batches) {
            if (remaining <= 0) break
            const deduct = Math.min(batch.currentQty, remaining)
            await tx.medicineBatch.update({ where: { id: batch.id }, data: { currentQty: batch.currentQty - deduct } })
            remaining -= deduct
          }
          if (remaining > 0) {
            warnings.push(`${medicineMap.get(item.medicineId)?.name ?? item.medicineId}: only partially deducted — not enough stock for the extra ${delta} unit(s)`)
          }
        } else {
          const restockQty = -delta
          const batch = await tx.medicineBatch.findFirst({
            where: { medicineId: item.medicineId },
            orderBy: { expiryDate: 'asc' },
          })
          if (batch) {
            await tx.medicineBatch.update({ where: { id: batch.id }, data: { currentQty: batch.currentQty + restockQty } })
          } else {
            warnings.push(`${medicineMap.get(item.medicineId)?.name ?? item.medicineId}: no batch found to restock ${restockQty} unit(s) onto`)
          }
        }
      }
    }

    for (const item of computed) {
      await tx.orderItem.update({
        where: { id: item.existing.id },
        data: {
          quantity: item.quantity,
          mrp: item.mrp,
          unitPrice: item.unitPrice,
          offerPercent: item.offerPercent,
          salesTax: item.salesTax,
          salesTaxAmount: item.salesTaxAmount,
          bonusQty: item.bonusQty,
          lineTotal: item.lineTotal,
        },
      })
    }

    const totalAmount = computed.reduce((s, i) => s + i.lineTotal, 0)
    const taxAmount = computed.reduce((s, i) => s + i.salesTaxAmount, 0)

    const updatedOrder = await tx.order.update({
      where: { id },
      data: {
        totalAmount,
        notes: body.notes !== undefined ? body.notes : undefined,
      },
      include: { items: { include: { medicine: { select: { name: true, code: true, category: true, salesTaxApplicable: true } } } } },
    })

    if (order.invoice) {
      const discountAmount = Number(order.invoice.discountAmount)
      await tx.invoice.update({
        where: { id: order.invoice.id },
        data: {
          subtotal: totalAmount,
          taxAmount,
          totalAmount: totalAmount - discountAmount + taxAmount,
        },
      })
    }

    return updatedOrder
  })

  return NextResponse.json({ data: result, warnings })
}

// ?hard=true → permanently deletes the order and its linked delivery/invoice
// default  → soft cancel (status = CANCELLED)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const hard = new URL(req.url).searchParams.get('hard') === 'true'

  const order = await prisma.order.findUnique({ where: { id }, select: { orderNumber: true } })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Distinct model tag so a MANAGER's pending request replays the right action on approval
  // (see app/api/approvals/[id]/route.ts) — soft cancel vs. permanent delete are not interchangeable.
  return handleDelete(req, hard ? 'Order-Hard' : 'Order', id, order.orderNumber, async () => {
    if (!hard) {
      await prisma.order.update({ where: { id }, data: { status: 'CANCELLED' } })
      return
    }

    // Hard delete — clean up related records first
    await prisma.$transaction(async (tx) => {
      // Remove delivery
      await tx.delivery.deleteMany({ where: { orderId: id } })
      await tx.deliveryChallan.deleteMany({ where: { orderId: id } })

      // Void invoice (delete payments first, then invoice)
      const invoice = await tx.invoice.findUnique({ where: { orderId: id } })
      if (invoice) {
        await tx.payment.deleteMany({ where: { invoiceId: invoice.id } })
        await tx.invoice.delete({ where: { id: invoice.id } })
      }

      // Delete order (cascades to order items via Prisma schema)
      await tx.order.delete({ where: { id } })
    })
  })
}
