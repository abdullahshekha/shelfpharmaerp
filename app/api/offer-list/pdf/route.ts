import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement, type JSXElementConstructor } from 'react'
import { prisma } from '@/lib/prisma'
import { getFefoBatch } from '@/lib/utils/pricing'
import { formatOfferComment } from '@/lib/utils/offer-comment'
import { OfferListPDF } from '@/components/offer-list/OfferListPDF'

export const dynamic = 'force-dynamic'
// Must run in Node.js runtime — @react-pdf/renderer uses Node APIs
export const runtime = 'nodejs'

function expiryToMMYY(expiryDate: Date): string {
  return `${String(expiryDate.getMonth() + 1).padStart(2, '0')}/${String(expiryDate.getFullYear()).slice(-2)}`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  const medicineInclude = {
    manufacturer: { select: { name: true } },
    batches: { select: { currentQty: true, expiryDate: true, tradePrice: true, mrp: true } },
  }

  const list = id
    ? await prisma.offerList.findUnique({ where: { id }, include: { items: { include: { medicine: { include: medicineInclude } } } } })
    : await prisma.offerList.findFirst({ where: { isActive: true }, include: { items: { include: { medicine: { include: medicineInclude } } } } })

  if (!list) {
    return NextResponse.json({ error: 'No active offer list found' }, { status: 404 })
  }

  const listDate = new Date(list.listDate)
  const dateStr = `${String(listDate.getMonth() + 1).padStart(2, '0')}/${String(listDate.getDate()).padStart(2, '0')}/${String(listDate.getFullYear()).slice(-2)}`

  const items = list.items.map((item) => {
    const fefoBatch = getFefoBatch(item.medicine.batches)
    const expiryMMYY = fefoBatch ? expiryToMMYY(fefoBatch.expiryDate) : null
    return {
      medicine: { name: item.medicine.name, manufacturer: { name: item.medicine.manufacturer.name } },
      offerPercent: Number(item.offerPercent),
      comments: formatOfferComment(item, expiryMMYY),
    }
  })

  const element = createElement(OfferListPDF, {
    listNumber: list.listNumber,
    listDate: dateStr,
    items,
  }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="OfferList-${list.listNumber}.pdf"`,
      'Content-Length': String(buffer.length),
    },
  })
}
