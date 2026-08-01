import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getFefoBatch } from '@/lib/utils/pricing'
import { isOfferAtLoss } from '@/lib/utils/offer-comment'

export const dynamic = 'force-dynamic'

function expiryToMMYY(expiryDate: Date): string {
  return `${String(expiryDate.getMonth() + 1).padStart(2, '0')}/${String(expiryDate.getFullYear()).slice(-2)}`
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const list = await prisma.offerList.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          medicine: {
            include: {
              manufacturer: { select: { name: true } },
              batches: { select: { currentQty: true, expiryDate: true, purchasePrice: true, tradePrice: true, mrp: true } },
            },
          },
        },
        orderBy: { medicine: { name: 'asc' } },
      },
      assignments: { select: { customerType: true } },
      _count: { select: { customers: true } },
    },
  })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = list.items.map((item) => {
    const batches = item.medicine.batches
    const stock = batches.reduce((s, b) => s + b.currentQty, 0)
    const fefoBatch = getFefoBatch(batches)
    const expiryMMYY = fefoBatch ? expiryToMMYY(fefoBatch.expiryDate) : null
    const purchasePrice = fefoBatch ? Number(fefoBatch.purchasePrice) : null
    const tradePrice = item.specialPrice != null ? Number(item.specialPrice) : null
    const isLoss = isOfferAtLoss(item, tradePrice, purchasePrice)
    return { ...item, stock, expiryMMYY, purchasePrice, isLoss }
  })

  return NextResponse.json({ data: { ...list, items } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  return await prisma.$transaction(async (tx) => {
    // Activating this list — deactivate all others first
    if (body.isActive === true) {
      await tx.offerList.updateMany({ where: { isActive: true }, data: { isActive: false } })
    }

    const list = await tx.offerList.update({
      where: { id },
      data: {
        name: body.name !== undefined ? (body.name?.trim() || null) : undefined,
        isActive: body.isActive ?? undefined,
        listDate: body.listDate ? new Date(body.listDate) : undefined,
      },
    })

    // Upsert items if provided — purchasePercent is never accepted here, it's only ever set by /refresh
    if (body.items && Array.isArray(body.items)) {
      for (const item of body.items) {
        const commentType = item.commentType ?? 'NONE'
        const fields = {
          // Net Price is an absolute override — Offer % is locked to 0 whenever it's selected
          offerPercent: commentType === 'NET_PRICE' ? 0 : (item.offerPercent ?? 0),
          specialPrice: item.specialPrice ?? null,
          salesTax: item.salesTax ?? 0,
          commentType,
          commentNetPrice: item.commentNetPrice ?? null,
          commentMinOrderQty: item.commentMinOrderQty ?? null,
          commentQtyFree: item.commentQtyFree ?? null,
          commentExtraPercent: item.commentExtraPercent ?? null,
        }
        await tx.offerListItem.upsert({
          where: { offerListId_medicineId: { offerListId: id, medicineId: item.medicineId } },
          update: fields,
          create: { offerListId: id, medicineId: item.medicineId, ...fields },
        })
      }
    }

    return NextResponse.json({ data: list })
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.offerList.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
