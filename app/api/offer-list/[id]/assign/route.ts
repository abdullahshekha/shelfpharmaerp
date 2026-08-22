import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Assigns one or more Customer Types to this Offer List. Assigning expands each type to its
// matching retailers (Retailer.customerType), creating one quantity-entry sheet (OfferListCustomer)
// per retailer — seeded with every medicine currently on the list at qty 0 — if that retailer
// doesn't already have one.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const customerTypes: string[] = body.customerTypes ?? []
  if (customerTypes.length === 0) {
    return NextResponse.json({ error: 'customerTypes required' }, { status: 400 })
  }

  const list = await prisma.offerList.findUnique({ where: { id }, include: { items: true } })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const retailers = await prisma.retailer.findMany({
    where: { customerType: { in: customerTypes } },
    select: { id: true },
  })
  const retailerIds = retailers.map((r) => r.id)

  // Bulk operations instead of a per-retailer upsert loop — the old loop did 2-3 sequential
  // round trips per retailer inside one interactive transaction, which timed out (and reported
  // "failed to assign") once a customer type expanded to more than ~100-200 retailers.
  await prisma.offerListAssignment.createMany({
    data: customerTypes.map((customerType) => ({ offerListId: id, customerType })),
    skipDuplicates: true,
  })

  if (retailerIds.length > 0) {
    await prisma.offerListCustomer.createMany({
      data: retailerIds.map((retailerId) => ({ offerListId: id, retailerId })),
      skipDuplicates: true,
    })

    if (list.items.length > 0) {
      const sheets = await prisma.offerListCustomer.findMany({
        where: { offerListId: id, retailerId: { in: retailerIds } },
        select: { id: true },
      })

      await prisma.offerListCustomerItem.createMany({
        data: sheets.flatMap((sheet) =>
          list.items.map((item) => ({
            offerListCustomerId: sheet.id,
            medicineId: item.medicineId,
            quantity: 0,
          }))
        ),
        skipDuplicates: true,
      })
    }
  }

  return NextResponse.json({ data: { customers: retailerIds.length } })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const customerType = searchParams.get('customerType')
  if (!customerType) return NextResponse.json({ error: 'customerType required' }, { status: 400 })

  await prisma.offerListAssignment.delete({
    where: { offerListId_customerType: { offerListId: id, customerType } },
  })
  return NextResponse.json({ success: true })
}
