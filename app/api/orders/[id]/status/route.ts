import { NextRequest, NextResponse } from 'next/server'
import { setOrderStatus } from '@/lib/orders/set-status'
import { AccountingError } from '@/lib/accounting/core'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { status } = await req.json()
  try {
    const { order, warnings } = await setOrderStatus(id, status)
    return NextResponse.json({ data: order, warnings })
  } catch (err) {
    // e.g. un-delivering an order whose delivery cost is in a locked accounting period: nothing changed.
    if (err instanceof AccountingError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
