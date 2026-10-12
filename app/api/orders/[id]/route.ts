import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleDelete } from '@/lib/utils/delete-approval'
import { getUserFromRequest } from '@/lib/utils/auth'
import { deductFefo, blendUnitCost, restockFefo, adjustDeductedQty, restockOnDecrease } from '@/lib/accounting/cost'
import { AccountingError } from '@/lib/accounting/core'
import { syncAllSafe } from '@/lib/accounting/sync'
import { cancelOrder, hardDeleteOrder } from '@/lib/orders/lifecycle'

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

  let result
  try {
  result = await prisma.$transaction(async (tx) => {
    // Lock the order row for the rest of the transaction: a concurrent cancel / un-deliver / edit waits here (or we
    // wait for it), so the status and item values below are the committed, current ones.
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Order" WHERE "id" = ${id} FOR UPDATE`
    if (!locked.length) throw new AccountingError(404, 'Not found')
    const liveStatus = locked[0].status
    if ((liveStatus === 'DELIVERED') !== (order.status === 'DELIVERED')) {
      throw new AccountingError(409, 'The order status changed while you were editing — reload and try again')
    }
    // Re-read the items inside the transaction (quantity / deductedQty / unitCost must be current for the stock delta).
    const freshItems = await tx.orderItem.findMany({ where: { orderId: id } })
    const freshById = new Map(freshItems.map((i) => [i.id, i]))
    if (freshItems.length !== editItems.length || editItems.some((i) => !freshById.has(i.id))) {
      throw new AccountingError(409, 'The order lines changed while you were editing — reload and try again')
    }

    const computed = editItems.map((item) => {
      const existing = freshById.get(item.id)!
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

    const newCosts = new Map<string, number>()
    const newDeducted = new Map<string, number>()
    if (liveStatus === 'DELIVERED') {
      for (const item of computed) {
        const delta = item.quantity - item.existing.quantity
        if (delta === 0) continue

        if (delta > 0) {
          const { costSum: extraCostSum, deducted, remaining } = await deductFefo(tx, item.medicineId, delta)
          // Keep the weighted COGS unit cost in step: blend the old cost with the newly deducted units.
          const oldCost = item.existing.unitCost
          const blended = blendUnitCost(item.existing.quantity, oldCost === null ? null : Number(oldCost), extraCostSum, delta)
          if (blended !== null) newCosts.set(item.existing.id, blended)
          newDeducted.set(item.existing.id, adjustDeductedQty(item.existing.deductedQty, item.existing.quantity, { deducted }))
          if (remaining > 0) {
            warnings.push(`${medicineMap.get(item.medicineId)?.name ?? item.medicineId}: only partially deducted — not enough stock for the extra ${delta} unit(s)`)
          }
        } else {
          // Never put back more than this line actually took off the shelf.
          const restockQty = restockOnDecrease(item.existing.deductedQty, item.existing.quantity, delta)
          const { restocked, warning } = await restockFefo(tx, item.medicineId, restockQty)
          newDeducted.set(item.existing.id, adjustDeductedQty(item.existing.deductedQty, item.existing.quantity, { restocked }))
          if (warning) warnings.push(`${medicineMap.get(item.medicineId)?.name ?? item.medicineId}: ${warning}`)
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
          ...(newCosts.has(item.existing.id) ? { unitCost: newCosts.get(item.existing.id) } : {}),
          ...(newDeducted.has(item.existing.id) ? { deductedQty: newDeducted.get(item.existing.id) } : {}),
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
  }, { maxWait: 10000, timeout: 20000 })
  } catch (err) {
    if (err instanceof AccountingError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }

  await syncAllSafe([['INVOICE', order.invoice?.id], ['DELIVERY_COGS', id]])

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
  // Both paths restock a DELIVERED order's deducted units (see lib/orders/lifecycle.ts); the approvals executor
  // calls the same functions for a MANAGER-requested delete.
  return handleDelete(req, hard ? 'Order-Hard' : 'Order', id, order.orderNumber, async () => {
    try {
      const { warnings } = hard ? await hardDeleteOrder(id) : await cancelOrder(id)
      return { warnings }
    } catch (err) {
      // e.g. the delivery cost was posted in a locked accounting period: nothing is changed.
      if (err instanceof AccountingError) return NextResponse.json({ error: err.message }, { status: err.status })
      throw err
    }
  })
}
