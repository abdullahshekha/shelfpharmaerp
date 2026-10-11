import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncSafe } from '@/lib/accounting/sync'

export const dynamic = 'force-dynamic'

interface ReturnItemInput {
  medicineId: string
  batchId: string
  quantity: number
  reason?: string
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const returns = await prisma.supplierReturn.findMany({
    where: { supplierId: id },
    include: { items: { include: { medicine: { select: { name: true, code: true } } } } },
    orderBy: { returnDate: 'desc' },
  })
  return NextResponse.json({ data: returns })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  if (!body.items?.length) return NextResponse.json({ error: 'At least one item required' }, { status: 400 })

  const items: ReturnItemInput[] = body.items
  for (const item of items) {
    if (!item.medicineId || !item.batchId || !item.quantity) {
      return NextResponse.json({ error: 'Each item requires medicine, batch and quantity' }, { status: 400 })
    }
  }

  const batches = await prisma.medicineBatch.findMany({
    where: { id: { in: items.map((i) => i.batchId) } },
  })
  const batchMap = new Map(batches.map((b) => [b.id, b]))

  for (const item of items) {
    const batch = batchMap.get(item.batchId)
    if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    if (batch.currentQty < item.quantity) {
      return NextResponse.json(
        { error: `Only ${batch.currentQty} in stock for batch ${batch.batchNumber}, cannot return ${item.quantity}` },
        { status: 400 }
      )
    }
  }

  const computedItems = items.map((item) => {
    const batch = batchMap.get(item.batchId)!
    const purchasePrice = Number(batch.purchasePrice)
    return {
      medicineId: item.medicineId,
      batchId: item.batchId,
      quantity: item.quantity,
      purchasePrice,
      lineTotal: purchasePrice * item.quantity,
      reason: item.reason ?? null,
    }
  })

  const totalAmount = computedItems.reduce((sum, item) => sum + item.lineTotal, 0)
  const returnNumber = `SP-RET-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')}`

  const supplierReturn = await prisma.$transaction(async (tx) => {
    const created = await tx.supplierReturn.create({
      data: {
        returnNumber,
        supplierId: id,
        returnDate: new Date(body.returnDate ?? new Date()),
        totalAmount,
        notes: body.notes ?? null,
        items: { create: computedItems },
      },
      include: { items: true },
    })

    for (const item of computedItems) {
      await tx.medicineBatch.update({
        where: { id: item.batchId },
        data: { currentQty: { decrement: item.quantity } },
      })
    }

    return created
  })

  await syncSafe('SUPPLIER_RETURN', supplierReturn.id)

  return NextResponse.json({ data: supplierReturn }, { status: 201 })
}
