import { NextRequest, NextResponse } from 'next/server'
import { getPortalCustomerFromRequest } from '@/lib/portal/session'
import { nextBookingCutoff } from '@/lib/utils/area-schedule'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const bookingDays = customer.area?.bookingDays ?? []
  return NextResponse.json({
    data: {
      name: customer.name,
      deliveryDays: customer.area?.deliveryDays ?? [],
      bookingDays,
      nextBooking: nextBookingCutoff(bookingDays),
    },
  })
}
