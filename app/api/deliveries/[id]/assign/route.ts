import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/utils/auth'
import { assignDelivery, unassignDelivery } from '@/lib/deliveries/assign'
import { canManageAssignments } from '@/lib/deliveries/assign-rules'
import { deliveryErrorResponse } from '@/lib/deliveries/http'

export const dynamic = 'force-dynamic'

// body: { driverId } assigns (stock leaves, order -> OUT_FOR_DELIVERY) or { unassign: true } takes it back
// (stock returns, order -> INVOICED). ADMIN/MANAGER only. Handing an assigned delivery to someone else is
// PUT /api/deliveries/[id] { driverId }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user.id || !canManageAssignments(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: { driverId?: unknown; unassign?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  try {
    if (body?.unassign === true) {
      const { warnings } = await unassignDelivery(id, user)
      return NextResponse.json({ data: { unassigned: true }, warnings })
    }
    if (typeof body?.driverId !== 'string' || !body.driverId) {
      return NextResponse.json({ error: 'Send { driverId } to assign or { unassign: true }' }, { status: 400 })
    }
    const { warnings } = await assignDelivery(id, body.driverId, user)
    return NextResponse.json({ data: { assigned: true }, warnings })
  } catch (e) {
    return deliveryErrorResponse(e, '[deliveries/assign]')
  }
}
