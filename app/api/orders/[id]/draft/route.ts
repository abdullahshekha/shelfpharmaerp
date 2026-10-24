import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isDraftEditable } from '@/lib/orders/draft'

export const dynamic = 'force-dynamic'

interface DraftItem {
  medicineId: string
  quantity: number
  mrp?: number | null
  unitPrice: number
  offerPercent?: number
  salesTax?: number
  bonusQty?: number
}

// Replaces all lines (and notes) of a DRAFT order. No invoice/delivery/stock/ledger side effects.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const items: DraftItem[] = body.items ?? []
  if (items.length === 0) return NextResponse.json({ error: 'A draft needs at least one line' }, { status: 400 })
  for (const i of items) {
    const b = i.bonusQty
    if (b !== undefined && b !== null && (typeof b !== 'number' || !Number.isInteger(b) || b < 0)) {
      return NextResponse.json({ error: 'bonusQty must be a whole number, 0 or more' }, { status: 400 })
    }
  }

  const medicines = await prisma.medicine.findMany({
    where: { id: { in: items.map((i) => i.medicineId) } },
    select: { id: true, salesTaxApplicable: true },
  })
  const medMap = new Map(medicines.map((m) => [m.id, m]))

  const result = await prisma.$transaction(async (tx) => {
    // Claim the row: only a DRAFT order may be rewritten.
    const claim = await tx.order.updateMany({
      where: { id, status: 'DRAFT' },
      data: { notes: body.notes ?? null, ...(body.retailerId ? { retailerId: body.retailerId } : {}) },
    })
    if (claim.count === 0) return null
    await tx.orderItem.deleteMany({ where: { orderId: id } })
    let totalAmount = 0
    for (const item of items) {
      const offerPercent = item.offerPercent ?? 0
      const salesTax = medMap.get(item.medicineId)?.salesTaxApplicable ? (item.salesTax ?? 0) : 0
      const lineTotal = item.quantity * item.unitPrice * (1 - offerPercent / 100)
      totalAmount += lineTotal
      await tx.orderItem.create({
        data: {
          orderId: id, medicineId: item.medicineId, quantity: item.quantity, mrp: item.mrp ?? null,
          unitPrice: item.unitPrice, offerPercent, salesTax, salesTaxAmount: salesTax * item.quantity,
          bonusQty: item.bonusQty ?? 0, lineTotal,
        },
      })
    }
    return tx.order.update({ where: { id }, data: { totalAmount }, include: { items: true } })
  })

  if (!result) {
    const o = await prisma.order.findUnique({ where: { id }, select: { status: true } })
    if (!o) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: `Only a draft can be edited (this order is ${o.status})` }, { status: isDraftEditable(o.status) ? 500 : 409 })
  }
  return NextResponse.json({ data: result })
}
