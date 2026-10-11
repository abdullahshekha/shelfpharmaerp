import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement, type JSXElementConstructor } from 'react'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { DeliveryChallanPDF } from '@/components/deliveries/DeliveryChallanPDF'
import { loadChallans } from '@/lib/challan'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// All challans for deliveries scheduled in the range — one PDF, one challan per page-flow.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const today = new Date().toISOString().slice(0, 10)
  const from = searchParams.get('from') ?? today
  const to = searchParams.get('to') ?? from
  const user = getUserFromRequest(req)

  const deliveries = await prisma.delivery.findMany({
    where: {
      scheduledDate: { gte: new Date(from), lt: new Date(new Date(to).getTime() + 86400000) },
      ...(user.role === 'SALESMAN' && { driverId: user.id }),
    },
    select: { orderId: true },
  })

  const challans = await loadChallans(deliveries.map(d => d.orderId))
  if (challans.length === 0) {
    return NextResponse.json({ error: 'No deliveries in this date range' }, { status: 404 })
  }

  const element = createElement(DeliveryChallanPDF, { challans }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer = await renderToBuffer(element)
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="delivery-challans-${from}${from === to ? '' : `_to_${to}`}.pdf"`,
      'Content-Length': String(buffer.length),
    },
  })
}
