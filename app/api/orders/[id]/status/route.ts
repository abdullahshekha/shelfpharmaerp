import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { setOrderStatus } from '@/lib/orders/set-status'
import { canSetViaStatusRoute } from '@/lib/orders/status'
import { AccountingError } from '@/lib/accounting/core'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

// Only RECEIVED -> INVOICED ("Confirm", admin/manager) and CANCELLED are set here. Every other move
// (assign / deliver / hold / return / un-assign) goes through the delivery functions.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { status } = await req.json()
  if (typeof status !== 'string' || !canSetViaStatusRoute(status)) {
    return NextResponse.json({ error: 'Status can only be set to INVOICED or CANCELLED here; use the delivery actions for other moves' }, { status: 400 })
  }
  if (status === 'INVOICED') {
    const user = getUserFromRequest(req)
    if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Only an admin or manager can confirm an order' }, { status: 403 })
    }
    const current = await prisma.order.findUnique({ where: { id }, select: { status: true } })
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (current.status !== 'RECEIVED') {
      return NextResponse.json({ error: `Only a received order can be confirmed (this order is ${current.status})` }, { status: 409 })
    }
  }
  try {
    const { order, warnings } = await setOrderStatus(id, status)
    return NextResponse.json({ data: order, warnings })
  } catch (err) {
    // e.g. cancelling an order whose delivery cost is in a locked accounting period: nothing changed.
    if (err instanceof AccountingError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
