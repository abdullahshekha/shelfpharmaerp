import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getPortalCustomerFromRequest } from '@/lib/portal/session'
import { resolveOfferListId, loadOfferItems } from '@/lib/portal/offer-list'
import { buildPricedLines, sanitizeCart } from '@/lib/portal/pricing'
import { findOpenOrder, savePortalOrder, PortalConflict } from '@/lib/portal/order'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ data: await findOpenOrder(customer.id) })
}

export async function PUT(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const orderId: string | null = typeof body?.orderId === 'string' && body.orderId ? body.orderId : null

  const cart = sanitizeCart(body?.items)
  if (!cart.ok) return NextResponse.json({ error: cart.error }, { status: 400 })
  if (cart.lines.length === 0 && !orderId) {
    return NextResponse.json({ error: 'Add at least one item to place an order' }, { status: 400 })
  }

  // Prices always come from the customer's own offer list, never from the request
  const listId = await resolveOfferListId(customer)
  if (!listId) return NextResponse.json({ error: 'No offer list is available for you right now' }, { status: 400 })
  const offers = new Map((await loadOfferItems(listId)).map(o => [o.medicineId, o]))
  const priced = buildPricedLines(cart.lines, offers)
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 })

  try {
    const data = await savePortalOrder({
      retailerId: customer.id,
      salesRepId: customer.salesRepId,
      orderId,
      lines: priced.lines,
      total: priced.total,
    })
    return NextResponse.json({ data })
  } catch (e) {
    if (e instanceof PortalConflict) return NextResponse.json({ error: e.message }, { status: 409 })
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2028') {
      return NextResponse.json({ error: 'We are busy — please try again in a moment' }, { status: 503 })
    }
    throw e
  }
}
