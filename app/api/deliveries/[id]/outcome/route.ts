import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/utils/auth'
import { recordOutcome } from '@/lib/deliveries/outcome'
import { deliveryErrorResponse } from '@/lib/deliveries/http'

export const dynamic = 'force-dynamic'

// body = OutcomeInput (+ allowDuplicate for a cheque number already on record). The amount to collect is computed
// server-side. 403 unless the caller is the delivery's assignee or a manager/admin (checked under the order lock).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user.id) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  try {
    const data = await recordOutcome(id, { id: user.id, role: user.role }, body as Parameters<typeof recordOutcome>[2])
    return NextResponse.json({ data })
  } catch (e) {
    return deliveryErrorResponse(e, '[deliveries/outcome]')
  }
}
