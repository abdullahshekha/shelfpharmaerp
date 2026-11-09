import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/utils/auth'
import { canAcknowledge, listPendingAcknowledgements } from '@/lib/deliveries/acknowledge'
import { deliveryErrorResponse } from '@/lib/deliveries/http'

export const dynamic = 'force-dynamic'

// The two acknowledgement lists: cash/bank collections waiting to become payments, and delivery returns whose stock
// has not been acknowledged back into the warehouse. ADMIN/MANAGER only.
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user.id) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!canAcknowledge(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json({ data: await listPendingAcknowledgements() })
  } catch (e) {
    return deliveryErrorResponse(e, '[delivery-acknowledgements]')
  }
}
