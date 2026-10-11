import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPortalCustomerFromRequest } from '@/lib/portal/session'
import { resolveOfferListId, loadOfferItems } from '@/lib/portal/offer-list'
import { toPublicItem } from '@/lib/portal/pricing'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const listId = await resolveOfferListId(customer)
  if (!listId) return NextResponse.json({ data: null })

  const [list, items] = await Promise.all([
    prisma.offerList.findUnique({ where: { id: listId }, select: { listNumber: true } }),
    loadOfferItems(listId),
  ])
  return NextResponse.json({ data: { listNumber: list?.listNumber ?? '', items: items.map(toPublicItem) } })
}
