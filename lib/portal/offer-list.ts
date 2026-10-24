import { prisma } from '@/lib/prisma'
import { getFefoBatch } from '@/lib/utils/pricing'
import { formatOfferComment } from '@/lib/utils/offer-comment'
import { resolveSalesTax } from '@/lib/utils/offer-pricing'
import type { ServerOfferItem } from '@/lib/portal/pricing'

/** The active offer list, if this customer is entitled to it (individual sheet, or their Customer Type is assigned). */
export async function resolveOfferListId(customer: { id: string; customerType: string | null }): Promise<string | null> {
  const list = await prisma.offerList.findFirst({ where: { isActive: true }, select: { id: true } })
  if (!list) return null

  const sheet = await prisma.offerListCustomer.findUnique({
    where: { offerListId_retailerId: { offerListId: list.id, retailerId: customer.id } },
    select: { id: true },
  })
  if (sheet) return list.id

  if (customer.customerType) {
    const assignment = await prisma.offerListAssignment.findUnique({
      where: { offerListId_customerType: { offerListId: list.id, customerType: customer.customerType } },
      select: { id: true },
    })
    if (assignment) return list.id
  }
  return null
}

const expiryToMMYY = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`

export async function loadOfferItems(listId: string): Promise<ServerOfferItem[]> {
  const items = await prisma.offerListItem.findMany({
    where: { offerListId: listId },
    include: {
      medicine: {
        select: {
          code: true, name: true, salesTaxApplicable: true,
          manufacturer: { select: { name: true } },
          batches: { select: { expiryDate: true, currentQty: true, tradePrice: true, mrp: true, salesTax: true } },
        },
      },
    },
  })

  const out: ServerOfferItem[] = []
  for (const item of items) {
    const fefo = getFefoBatch(item.medicine.batches)
    const unitPrice = item.specialPrice != null ? Number(item.specialPrice) : fefo ? Number(fefo.tradePrice) : null
    if (unitPrice === null) continue // nothing to charge — hide rather than sell at 0
    out.push({
      medicineId: item.medicineId,
      code: item.medicine.code,
      name: item.medicine.name,
      manufacturer: item.medicine.manufacturer?.name ?? '',
      unitPrice,
      offerPercent: Number(item.offerPercent),
      comment: formatOfferComment(item, fefo ? expiryToMMYY(new Date(fefo.expiryDate)) : null),
      salesTax: resolveSalesTax(fefo?.salesTax != null ? Number(fefo.salesTax) : null, Number(item.salesTax)),
      rule: {
        commentType: item.commentType,
        offerPercent: Number(item.offerPercent),
        commentNetPrice: item.commentNetPrice != null ? Number(item.commentNetPrice) : null,
        commentMinOrderQty: item.commentMinOrderQty,
        commentQtyFree: item.commentQtyFree,
        commentExtraPercent: item.commentExtraPercent != null ? Number(item.commentExtraPercent) : null,
      },
      salesTaxApplicable: item.medicine.salesTaxApplicable,
      mrp: fefo?.mrp != null ? Number(fefo.mrp) : null,
    })
  }
  return out.sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name))
}
