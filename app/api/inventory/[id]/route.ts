import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getEffectivePrice } from '@/lib/utils/pricing'
import { handleDelete } from '@/lib/utils/delete-approval'
import { getUserFromRequest } from '@/lib/utils/auth'
import { medicineDeleteBlockers } from '@/lib/inventory/delete-rules'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const medicine = await prisma.medicine.findUnique({
    where: { id },
    include: {
      manufacturer: true,
      batches: { orderBy: { expiryDate: 'asc' } },
    },
  })
  if (!medicine) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { tradePrice, mrp } = getEffectivePrice(medicine.batches)
  return NextResponse.json({ data: { ...medicine, tradePrice, mrp } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const medicine = await prisma.medicine.update({
    where: { id },
    data: {
      name: body.name,
      genericName: body.genericName ?? null,
      manufacturerId: body.manufacturerId,
      category: body.category ?? null,
      packSize: body.packSize ?? null,
      salesTaxApplicable: body.salesTaxApplicable ?? false,
      minStockLevel: body.minStockLevel ?? 10,
      isActive: body.isActive ?? true,
    },
  })

  return NextResponse.json({ data: medicine })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const medicine = await prisma.medicine.findUnique({ where: { id }, select: { name: true } })
  if (!medicine) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Admin: real delete when nothing references the item (otherwise 409 with the reasons; deactivate via PUT instead).
  if (getUserFromRequest(req).role === 'ADMIN') {
    const [stockBatches, purchaseLines, orderLines, supplierReturnLines, salesReturnLines, offerItems, offerCustomerItems] = await Promise.all([
      prisma.medicineBatch.count({ where: { medicineId: id, currentQty: { gt: 0 } } }),
      prisma.purchaseInvoiceItem.count({ where: { medicineId: id } }),
      prisma.orderItem.count({ where: { medicineId: id } }),
      prisma.supplierReturnItem.count({ where: { medicineId: id } }),
      prisma.salesReturnItem.count({ where: { medicineId: id } }),
      prisma.offerListItem.count({ where: { medicineId: id } }),
      prisma.offerListCustomerItem.count({ where: { medicineId: id } }),
    ])
    const blockers = medicineDeleteBlockers({
      stockBatches, purchaseLines, orderLines,
      returnLines: supplierReturnLines + salesReturnLines,
      offerListItems: offerItems + offerCustomerItems,
    })
    if (blockers.length > 0) {
      return NextResponse.json({ error: `${medicine.name} is in use and cannot be deleted`, blockers }, { status: 409 })
    }
    try {
      await prisma.$transaction([
        prisma.medicineBatch.deleteMany({ where: { medicineId: id, currentQty: 0 } }),
        prisma.medicine.delete({ where: { id } }),
      ])
    } catch {
      // A reference appeared between the check and the delete (the FK refused it).
      return NextResponse.json({ error: `${medicine.name} is in use and cannot be deleted`, blockers: ['it was just referenced elsewhere'] }, { status: 409 })
    }
    return NextResponse.json({ success: true })
  }

  return handleDelete(req, 'Medicine', id, medicine.name, async () => {
    await prisma.medicine.update({ where: { id }, data: { isActive: false } })
  })
}
