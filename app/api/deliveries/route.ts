import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getUserFromRequest } from '@/lib/utils/auth'
import { canManageAssignments } from '@/lib/deliveries/assign-rules'
import { isOrderStatus } from '@/lib/orders/status'
import { OUTCOMES } from '@/lib/deliveries/outcome-rules'

export const dynamic = 'force-dynamic'

// Filters: status (Delivery.status), orderStatus (comma list of Order statuses), outcome, driverId (ADMIN/MANAGER
// only), date (legacy single day) or from/to (scheduledDate, inclusive days).
// Scoping: ADMIN/MANAGER see every delivery; every other role sees only deliveries assigned to them
// (driverId = session id), whatever the query says.
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user.id) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const manager = canManageAssignments(user.role)

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? ''
  const date = searchParams.get('date') ?? '' // legacy single-date
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const orderStatuses = (searchParams.get('orderStatus') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const outcome = searchParams.get('outcome') ?? ''
  const driverFilter = searchParams.get('driverId') ?? ''

  if (orderStatuses.some((s) => !isOrderStatus(s))) return NextResponse.json({ error: 'Unknown order status' }, { status: 400 })
  if (outcome && !(OUTCOMES as readonly string[]).includes(outcome)) return NextResponse.json({ error: 'Unknown outcome' }, { status: 400 })
  const day = (v: string) => {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if ((date && !day(date)) || (from && !day(from)) || (to && !day(to))) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  const where: Prisma.DeliveryWhereInput = {
    ...(manager ? (driverFilter ? { driverId: driverFilter } : {}) : { driverId: user.id }),
    ...(status && { status }),
    ...(outcome && { outcome }),
    ...(orderStatuses.length > 0 && { order: { status: { in: orderStatuses } } }),
    ...(date && !from && {
      scheduledDate: {
        gte: new Date(date),
        lt: new Date(new Date(date).getTime() + 86400000),
      },
    }),
    ...((from || to) && {
      scheduledDate: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lt: new Date(new Date(to).getTime() + 86400000) }),
      },
    }),
  }

  const deliveries = await prisma.delivery.findMany({
    where,
    include: {
      order: {
        include: {
          retailer: {
            select: {
              name: true,
              address: true,
              phone: true,
              area: { select: { name: true } },
            },
          },
          invoice: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true } },
        },
      },
      driver: { select: { name: true } },
    },
    orderBy: { scheduledDate: 'asc' },
  })

  return NextResponse.json({ data: deliveries })
}
