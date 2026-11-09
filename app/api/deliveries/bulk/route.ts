import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/utils/auth'
import { assignDeliveries } from '@/lib/deliveries/assign'
import { canManageAssignments } from '@/lib/deliveries/assign-rules'
import { deliveryErrorResponse } from '@/lib/deliveries/http'

export const dynamic = 'force-dynamic'

const MAX_IDS = 200

// Assign many deliveries to one person. ADMIN/MANAGER only. Each delivery is assigned in its own transaction:
// one that is refused (short stock, wrong status, locked period) is reported and does not stop the others.
export async function PUT(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user.id || !canManageAssignments(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: { ids?: unknown; driverId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { ids, driverId } = body ?? {}
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== 'string' || !i)) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  }
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `At most ${MAX_IDS} deliveries at a time` }, { status: 400 })
  if (typeof driverId !== 'string' || !driverId) {
    return NextResponse.json({ error: 'Choose who the deliveries are assigned to' }, { status: 400 })
  }
  try {
    const { assigned, refused } = await assignDeliveries(ids as string[], driverId, user)
    return NextResponse.json({ assigned, refused })
  } catch (e) {
    return deliveryErrorResponse(e, '[deliveries/bulk]')
  }
}
