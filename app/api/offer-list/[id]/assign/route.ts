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

  const result = await prisma.$transaction(async (tx) => {
    for (const customerType of customerTypes) {
      await tx.offerListAssignment.upsert({
        where: { offerListId_customerType: { offerListId: id, customerType } },
        update: {},
        create: { offerListId: id, customerType },
      })
    }

    for (const { id: retailerId } of retailers) {
      const sheet = await tx.offerListCustomer.upsert({
        where: { offerListId_retailerId: { offerListId: id, retailerId } },
        update: {},
        create: { offerListId: id, retailerId },
      })

      const existingItems = await tx.offerListCustomerItem.findMany({
        where: { offerListCustomerId: sheet.id },
        select: { medicineId: true },
      })
      const existingMedicineIds = new Set(existingItems.map((i) => i.medicineId))
      const missing = list.items.filter((i) => !existingMedicineIds.has(i.medicineId))
      if (missing.length > 0) {
        await tx.offerListCustomerItem.createMany({
          data: missing.map((i) => ({
            offerListCustomerId: sheet.id,
            medicineId: i.medicineId,
            quantity: 0,
          })),
        })
      }
    }

    return { customers: retailers.length }
  })

  return NextResponse.json({ data: result })
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
