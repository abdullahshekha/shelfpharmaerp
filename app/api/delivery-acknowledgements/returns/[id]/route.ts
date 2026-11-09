import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/utils/auth'
import { acknowledgeReturnedStock, canAcknowledge } from '@/lib/deliveries/acknowledge'
import { deliveryErrorResponse } from '@/lib/deliveries/http'

export const dynamic = 'force-dynamic'

// Acknowledge that a delivery return's stock is back in the warehouse: restocks it (FEFO batch). ADMIN/MANAGER only.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user.id) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!canAcknowledge(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const { warnings } = await acknowledgeReturnedStock(id, { id: user.id, role: user.role })
    return NextResponse.json({ data: { ok: true }, warnings })
  } catch (e) {
    return deliveryErrorResponse(e, '[delivery-acknowledgements/returns]')
  }
}
