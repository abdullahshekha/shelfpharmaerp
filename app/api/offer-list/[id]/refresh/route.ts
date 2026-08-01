import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getEffectiveOffer } from '@/lib/utils/pricing'

export const dynamic = 'force-dynamic'

// Full resync: brand-new in-stock medicines get an OfferListItem seeded with Purchase %/Offer %/
// Trade Price from their FEFO batch (Purchase % is the combined max discount off Trade Price from
// that batch's Disc % and Bonus Qty — see calcPurchasePercent); medicines that have gone out of
// stock are dropped. Existing items are never touched here — Offer %, Comments, and Trade Price
// are staff-curated once set, and Stock/Expiry Date are read live off the medicine's batches at
// GET time rather than snapshotted, so they never go stale.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const list = await prisma.offerList.findUnique({ where: { id } })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const medicines = await prisma.medicine.findMany({
    where: { isActive: true },
    select: {
      id: true,
      salesTaxApplicable: true,
      batches: { select: { currentQty: true, expiryDate: true, tradePrice: true, mrp: true, discountPercent: true, bonusQuantity: true, quantityIn: true, purchasePrice: true } },
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

    for (const { medicine, offer } of added) {
      await tx.offerListItem.create({
        data: {
          offerListId: id,
          medicineId: medicine.id,
          purchasePercent: offer.purchasePercent,
          offerPercent: offer.purchasePercent,
          specialPrice: offer.tradePrice,
          salesTax: 0,
          commentType: 'NONE',
        },
      })
    }
  })

  return NextResponse.json({
    data: { total: inStock.length, added: added.length, removed: removed.length, updated: 0 },
  })
}
