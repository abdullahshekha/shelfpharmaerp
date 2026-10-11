import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement, type JSXElementConstructor } from 'react'
import { prisma } from '@/lib/prisma'
import { DeliveryManifestPDF } from '@/components/deliveries/DeliveryManifestPDF'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  // The Deliveries page sends from/to (a range); `date` is kept for older links.
  const today = new Date().toISOString().slice(0, 10)
  const from = searchParams.get('from') ?? searchParams.get('date') ?? today
  const to = searchParams.get('to') ?? searchParams.get('date') ?? from
  const groupBy: 'area' | 'driver' = searchParams.get('groupBy') === 'driver' ? 'driver' : 'area'
  const date = from === to ? from : `${from} to ${to}`

  const deliveries = await prisma.delivery.findMany({
    where: {
      scheduledDate: {
        gte: new Date(from),
        lt: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000),
      },
    },
    include: {
      order: {
        include: {
          retailer: {
            select: { name: true, phone: true, address: true, area: { select: { name: true } } },
          },
        },
      },
      driver: { select: { name: true } },
    },
    orderBy: { scheduledDate: 'asc' },
  })

  // Group by area name or driver name; 'Unassigned' always sorts last
  const grouped = new Map<string, typeof deliveries>()
  for (const d of deliveries) {
    const key = groupBy === 'driver' ? (d.driver?.name ?? 'Unassigned') : (d.order.retailer.area?.name ?? 'Unassigned')
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(d)
  }

  const areaGroups = Array.from(grouped.entries())
    .sort(([a], [b]) => (a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b)))
    .map(([groupName, deliveries]) => ({
      groupName,
      deliveries: (groupBy === 'driver'
        ? [...deliveries].sort((x, y) => (x.order.retailer.area?.name ?? '~').localeCompare(y.order.retailer.area?.name ?? '~'))
        : deliveries
      ).map(d => ({
        id: d.id,
        status: d.status,
        driver: d.driver,
        order: {
          orderNumber: d.order.orderNumber,
          totalAmount: Number(d.order.totalAmount),
          retailer: {
            name: d.order.retailer.name,
            phone: d.order.retailer.phone,
            address: d.order.retailer.address,
            area: d.order.retailer.area,
          },
        },
      })),
    }))

  if (areaGroups.length === 0) {
    return NextResponse.json({ error: 'No deliveries for this date' }, { status: 404 })
  }

  const props = { date, areaGroups, totalDeliveries: deliveries.length, groupBy }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(DeliveryManifestPDF, props) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="delivery-manifest-${groupBy}-${from}${from === to ? '' : `_to_${to}`}.pdf"`,
      'Content-Length': String(buffer.length),
    },
  })
}
