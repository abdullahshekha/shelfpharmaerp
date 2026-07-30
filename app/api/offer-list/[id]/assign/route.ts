import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Assigns one or more Customer Groups to this Offer List. Assigning expands each group to its
// member retailers, creating one quantity-entry sheet (OfferListCustomer) per retailer — seeded
// with every medicine currently on the list at qty 0 — if that retailer doesn't already have one.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const customerGroupIds: string[] = body.customerGroupIds ?? []
  if (customerGroupIds.length === 0) {
    return NextResponse.json({ error: 'customerGroupIds required' }, { status: 400 })
  }

  const list = await prisma.offerList.findUnique({ where: { id }, include: { items: true } })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const members = await prisma.customerGroupMember.findMany({
    where: { customerGroupId: { in: customerGroupIds } },
    select: { retailerId: true },
    distinct: ['retailerId'],
  })

  const result = await prisma.$transaction(async (tx) => {
    for (const groupId of customerGroupIds) {
      await tx.offerListAssignment.upsert({
        where: { offerListId_customerGroupId: { offerListId: id, customerGroupId: groupId } },
        update: {},
        create: { offerListId: id, customerGroupId: groupId },
      })
    }

    for (const { retailerId } of members) {
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

    return { customers: members.length }
  })

  return NextResponse.json({ data: result })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const customerGroupId = searchParams.get('customerGroupId')
  if (!customerGroupId) return NextResponse.json({ error: 'customerGroupId required' }, { status: 400 })

  await prisma.offerListAssignment.delete({
    where: { offerListId_customerGroupId: { offerListId: id, customerGroupId } },
  })
  return NextResponse.json({ success: true })
}
