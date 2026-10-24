import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncSafe } from '@/lib/accounting/sync'
import { setOrderStatus } from '@/lib/orders/set-status'
import { AccountingError } from '@/lib/accounting/core'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

const EARLIER_THAN_DISPATCHED = ['PENDING', 'CONFIRMED', 'PICKING']

// body: { action: 'start' | 'deliver' | 'fail' | 'reschedule', scheduledDate?, driverId?, notes? }
// A plain { driverId } / { notes } body (no action) just updates those fields. Delivery status is never
// written as DELIVERED directly: 'deliver' goes through setOrderStatus so stock/COGS stay consistent.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const action: string | undefined = body.action

  const existing = await prisma.delivery.findUnique({ where: { id }, include: { order: { select: { id: true, status: true } } } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const user = getUserFromRequest(req)
  // A Salesman only works their own deliveries and cannot reassign drivers.
  if (user.role === 'SALESMAN' && existing.driverId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const fields = {
    driverId: body.driverId !== undefined && user.role !== 'SALESMAN' ? (body.driverId || null) : undefined,
    notes: body.notes !== undefined ? body.notes : undefined,
  }
  const warnings: string[] = []

  try {
    if (action === 'deliver') {
      const r = await setOrderStatus(existing.orderId, 'DELIVERED')
      warnings.push(...r.warnings)
      await prisma.delivery.update({ where: { id }, data: fields })
    } else if (action === 'start') {
      await prisma.delivery.update({ where: { id }, data: { ...fields, status: 'OUT_FOR_DELIVERY' } })
      if (EARLIER_THAN_DISPATCHED.includes(existing.order.status)) {
        const r = await setOrderStatus(existing.orderId, 'DISPATCHED')
        warnings.push(...r.warnings)
      }
    } else if (action === 'fail') {
      await prisma.delivery.update({ where: { id }, data: { ...fields, status: 'FAILED' } })
    } else if (action === 'reschedule') {
      const d = new Date(body.scheduledDate)
      if (!body.scheduledDate || Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'scheduledDate is required to reschedule' }, { status: 400 })
      }
      await prisma.delivery.update({ where: { id }, data: { ...fields, status: 'RESCHEDULED', scheduledDate: d } })
    } else if (action === undefined) {
      if (body.status === 'DELIVERED') {
        return NextResponse.json({ error: "Use action 'deliver' to mark a delivery delivered" }, { status: 400 })
      }
      await prisma.delivery.update({ where: { id }, data: { ...fields, status: body.status ?? undefined } })
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err) {
    if (err instanceof AccountingError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }

  await syncSafe('DELIVERY_COGS', existing.orderId)
  const delivery = await prisma.delivery.findUnique({ where: { id } })
  return NextResponse.json({ data: delivery, warnings })
}
