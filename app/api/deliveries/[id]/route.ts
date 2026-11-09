import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { reassignDelivery } from '@/lib/deliveries/assign'
import { canManageAssignments } from '@/lib/deliveries/assign-rules'
import { deliveryErrorResponse } from '@/lib/deliveries/http'

export const dynamic = 'force-dynamic'

// body: { notes?, driverId? }
// - notes: ADMIN/MANAGER on any delivery, anyone else only on a delivery assigned to them.
// - driverId: ADMIN/MANAGER only; hands an assigned delivery (no outcome yet) to someone else (reassignDelivery: no
//   stock or ledger effect). Assigning / un-assigning is POST /api/deliveries/[id]/assign, outcomes are
//   POST /api/deliveries/[id]/outcome. Delivery status is never written here.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user.id) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let body: { action?: unknown; status?: unknown; driverId?: unknown; notes?: unknown; scheduledDate?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  if (body.action !== undefined || body.status !== undefined || body.scheduledDate !== undefined) {
    return NextResponse.json(
      { error: 'Use POST /api/deliveries/[id]/assign to assign and POST /api/deliveries/[id]/outcome to record what happened' },
      { status: 400 },
    )
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return NextResponse.json({ error: 'notes must be text' }, { status: 400 })
  }

  const existing = await prisma.delivery.findUnique({ where: { id }, select: { id: true, driverId: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const manager = canManageAssignments(user.role)
  if (!manager && existing.driverId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    if (body.driverId !== undefined) {
      if (!manager) return NextResponse.json({ error: 'Only an admin or manager can change who a delivery is assigned to' }, { status: 403 })
      if (typeof body.driverId !== 'string' || !body.driverId) {
        return NextResponse.json({ error: 'To take a delivery back use POST /api/deliveries/[id]/assign { unassign: true }' }, { status: 400 })
      }
      if (body.driverId !== existing.driverId) await reassignDelivery(id, body.driverId, user)
    }
    if (body.notes !== undefined) {
      const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
      await prisma.delivery.update({ where: { id }, data: { notes } })
    }
  } catch (e) {
    return deliveryErrorResponse(e, '[deliveries/[id]]')
  }

  const delivery = await prisma.delivery.findUnique({ where: { id } })
  return NextResponse.json({ data: delivery })
}
