import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getEffectiveOffer } from '@/lib/utils/pricing'

export const dynamic = 'force-dynamic'

// Full resync: every in-stock medicine gets an OfferListItem with Offer %/Bonus/TP taken from
// its FEFO batch (which snapshots the Disc % and bonus qty it was purchased at); medicines that
// have gone out of stock are dropped. Sales Tax is left as-is on existing rows since it isn't
// sourced from Purchase Invoice data.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const list = await prisma.offerList.findUnique({ where: { id } })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const medicines = await prisma.medicine.findMany({
    where: { isActive: true },
    select: {
      id: true,
      salesTaxApplicable: true,
      batches: { select: { currentQty: true, expiryDate: true, tradePrice: true, mrp: true, discountPercent: true, bonusQuantity: true } },
    },
  })

  const inStock = medicines
    .map((m) => ({ medicine: m, offer: getEffectiveOffer(m.batches) }))
    .filter((x) => x.offer.tradePrice !== null)

  const existingItems = await prisma.offerListItem.findMany({ where: { offerListId: id } })
  const existingByMedicine = new Map(existingItems.map((i) => [i.medicineId, i]))
  const inStockIds = new Set(inStock.map((x) => x.medicine.id))

  const removed = existingItems.filter((i) => !inStockIds.has(i.medicineId))
  const added = inStock.filter((x) => !existingByMedicine.has(x.medicine.id))

  await prisma.$transaction(async (tx) => {
    if (removed.length > 0) {
      await tx.offerListItem.deleteMany({ where: { id: { in: removed.map((i) => i.id) } } })
    }

    for (const { medicine, offer } of inStock) {
      await tx.offerListItem.upsert({
        where: { offerListId_medicineId: { offerListId: id, medicineId: medicine.id } },
        update: {
          offerPercent: offer.offerPercent,
          bonusQty: offer.bonusQty,
          specialPrice: offer.tradePrice,
        },
        create: {
          offerListId: id,
          medicineId: medicine.id,
          offerPercent: offer.offerPercent,
          bonusQty: offer.bonusQty,
          specialPrice: offer.tradePrice,
          salesTax: 0,
        },
      })
    }
  })

  return NextResponse.json({
    data: { total: inStock.length, added: added.length, removed: removed.length, updated: inStock.length - added.length },
  })
}
