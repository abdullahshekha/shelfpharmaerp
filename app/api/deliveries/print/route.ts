import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement, type JSXElementConstructor } from 'react'
import { prisma } from '@/lib/prisma'
import { DeliveryManifestPDF } from '@/components/deliveries/DeliveryManifestPDF'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  const deliveries = await prisma.delivery.findMany({
    where: {
      scheduledDate: {
        gte: new Date(date),
        lt: new Date(new Date(date).getTime() + 24 * 60 * 60 * 1000),
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

  // Group by area name
  const grouped = new Map<string, typeof deliveries>()
  for (const d of deliveries) {
    const areaName = d.order.retailer.area?.name ?? 'Unassigned'
    if (!grouped.has(areaName)) grouped.set(areaName, [])
    grouped.get(areaName)!.push(d)
  }

  const areaGroups = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([areaName, deliveries]) => ({
      areaName,
      deliveries: deliveries.map(d => ({
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

  const props = { date, areaGroups, totalDeliveries: deliveries.length }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(DeliveryManifestPDF, props) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="delivery-manifest-${date}.pdf"`,
      'Content-Length': String(buffer.length),
    },
  })
}
