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
              batches: { select: { currentQty: true, expiryDate: true, purchasePrice: true, tradePrice: true, mrp: true, salesTax: true } },
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
    // Read-only Sales Tax (Rs/unit) from the FEFO batch; null when the medicine is not Sales Tax Applicable.
    const fefoSalesTax = item.medicine.salesTaxApplicable ? Number(fefoBatch?.salesTax ?? item.salesTax ?? 0) : null
    return { ...item, stock, expiryMMYY, purchasePrice, isLoss, fefoSalesTax }
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
      // Lines whose values are unchanged are skipped: each upsert is an audited write (extra round trips), and the
      // editor sends the whole list (~700 lines) on every save.
      const existing = new Map(
        (await tx.offerListItem.findMany({ where: { offerListId: id } })).map((e) => [e.medicineId, e]),
      )
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
        const prev = existing.get(item.medicineId)
        if (prev && sameOfferFields(prev, fields)) continue
        await tx.offerListItem.upsert({
          where: { offerListId_medicineId: { offerListId: id, medicineId: item.medicineId } },
          update: fields,
          create: { offerListId: id, medicineId: item.medicineId, ...fields },
        })
      }
    }

    return NextResponse.json({ data: list })
  }, { maxWait: 10000, timeout: 60000 })
}

// Only plain numbers are compared; anything else (strings etc.) always goes through the upsert as before.
const sameNum = (a: unknown, b: unknown) =>
  a == null || b == null ? a == null && b == null : typeof b === 'number' && Number(a) === b

/** True when the stored line already holds exactly these values (so the upsert would change nothing). */
function sameOfferFields(prev: Record<string, unknown>, f: Record<string, unknown>): boolean {
  if (prev.commentType !== f.commentType) return false
  return ['offerPercent', 'specialPrice', 'salesTax', 'commentNetPrice', 'commentMinOrderQty', 'commentQtyFree', 'commentExtraPercent']
    .every((k) => sameNum(prev[k], f[k]))
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.offerList.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
