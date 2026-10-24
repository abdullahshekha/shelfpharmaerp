import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getFefoBatch } from '@/lib/utils/pricing'
import { formatOfferComment } from '@/lib/utils/offer-comment'

export const dynamic = 'force-dynamic'

function expiryToMMYY(expiryDate: Date): string {
  return `${String(expiryDate.getMonth() + 1).padStart(2, '0')}/${String(expiryDate.getFullYear()).slice(-2)}`
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; customerId: string }> }) {
  const { id, customerId } = await params

  const sheet = await prisma.offerListCustomer.findUnique({
    where: { id: customerId },
    include: {
      retailer: { select: { id: true, name: true, phone: true } },
      offerList: { select: { id: true, name: true, listNumber: true } },
      items: {
        include: {
          medicine: {
            include: {
              manufacturer: { select: { name: true } },
              batches: { select: { currentQty: true, expiryDate: true, tradePrice: true, mrp: true, salesTax: true } },
            },
          },
        },
        orderBy: { medicine: { name: 'asc' } },
      },
    },
  })
  if (!sheet || sheet.offerListId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Pull each item's Offer %/Comments/TP from the parent offer list, since OfferListCustomerItem only stores quantity.
  const offerItems = await prisma.offerListItem.findMany({ where: { offerListId: id } })
  const offerByMedicine = new Map(offerItems.map((i) => [i.medicineId, i]))

  const items = sheet.items.map((item) => {
    const offer = offerByMedicine.get(item.medicineId)
    const fefoBatch = getFefoBatch(item.medicine.batches)
    const expiryMMYY = fefoBatch ? expiryToMMYY(fefoBatch.expiryDate) : null
    const offerPercent = offer?.offerPercent ?? 0
    const comments = offer ? formatOfferComment({ ...offer, offerPercent }, expiryMMYY) : '—'
    return {
      id: item.id,
      medicine: { id: item.medicine.id, code: item.medicine.code, name: item.medicine.name, manufacturer: item.medicine.manufacturer },
      quantity: item.quantity,
      offerPercent,
      specialPrice: offer?.specialPrice ?? null,
      comments,
      commentType: offer?.commentType ?? 'NONE',
      fefoSalesTax: item.medicine.salesTaxApplicable ? Number(fefoBatch?.salesTax ?? offer?.salesTax ?? 0) : null,
    }
  })

  return NextResponse.json({ data: { ...sheet, items } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; customerId: string }> }) {
  const { id, customerId } = await params
  const body = await req.json()
  const items: { medicineId: string; quantity: number }[] = body.items ?? []

  const sheet = await prisma.offerListCustomer.findUnique({ where: { id: customerId } })
  if (!sheet || sheet.offerListId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction(
    items.map((item) =>
      prisma.offerListCustomerItem.upsert({
        where: { offerListCustomerId_medicineId: { offerListCustomerId: customerId, medicineId: item.medicineId } },
        update: { quantity: item.quantity },
        create: { offerListCustomerId: customerId, medicineId: item.medicineId, quantity: item.quantity },
      })
    )
  )

  return NextResponse.json({ success: true })
}

// Removes this individual customer's quantity sheet from the offer list (their override, or a
// sheet created via a Customer Type assignment). Items cascade-delete with the sheet.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; customerId: string }> }) {
  const { id, customerId } = await params
  const sheet = await prisma.offerListCustomer.findUnique({ where: { id: customerId } })
  if (!sheet || sheet.offerListId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.offerListCustomer.delete({ where: { id: customerId } })
  return NextResponse.json({ success: true })
}
