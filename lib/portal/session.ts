import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PORTAL_COOKIE, decodePortalSession } from '@/lib/utils/portal-auth'
import type { BookingDay } from '@/lib/utils/area-schedule'

export interface PortalCustomer {
  id: string
  name: string
  customerType: string | null
  salesRepId: string | null
  area: { name: string; deliveryDays: number[]; bookingDays: BookingDay[] } | null
}

/** Verifies the cookie AND re-checks the account on every request, so disabling/deactivating/resetting takes effect immediately. */
export async function getPortalCustomer(token: string | undefined): Promise<PortalCustomer | null> {
  if (!token) return null
  const session = decodePortalSession(token)
  if (!session) return null

  const r = await prisma.retailer.findUnique({
    where: { id: session.rid },
    select: {
      id: true, name: true, customerType: true, salesRepId: true,
      isActive: true, portalEnabled: true, portalSessionVersion: true,
      area: { select: { name: true, deliveryDays: true, bookingDays: true } },
    },
  })
  if (!r || !r.isActive || !r.portalEnabled || r.portalSessionVersion !== session.v) return null

  return {
    id: r.id,
    name: r.name,
    customerType: r.customerType,
    salesRepId: r.salesRepId,
    area: r.area
      ? { name: r.area.name, deliveryDays: r.area.deliveryDays, bookingDays: Array.isArray(r.area.bookingDays) ? (r.area.bookingDays as unknown as BookingDay[]) : [] }
      : null,
  }
}

export const getPortalCustomerFromRequest = (req: NextRequest) =>
  getPortalCustomer(req.cookies.get(PORTAL_COOKIE)?.value)
