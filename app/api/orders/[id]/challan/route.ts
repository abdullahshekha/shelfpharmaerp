import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement, type JSXElementConstructor } from 'react'
import { DeliveryChallanPDF } from '@/components/deliveries/DeliveryChallanPDF'
import { loadChallans } from '@/lib/challan'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const challans = await loadChallans([id])
  if (challans.length === 0) {
    return NextResponse.json({ error: 'No challan yet — it is created when the order is confirmed' }, { status: 404 })
  }
  const element = createElement(DeliveryChallanPDF, { challans }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer = await renderToBuffer(element)
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${challans[0].challanNumber}.pdf"`,
      'Content-Length': String(buffer.length),
    },
  })
}
