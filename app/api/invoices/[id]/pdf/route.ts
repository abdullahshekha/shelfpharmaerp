import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement, type JSXElementConstructor } from 'react'
import { prisma } from '@/lib/prisma'
import { InvoicePDF } from '@/components/invoices/InvoicePDF'

export const dynamic = 'force-dynamic'
// Must run in Node.js runtime — @react-pdf/renderer uses Node APIs
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      retailer: { include: { area: { select: { name: true } } } },
      order: {
        include: {
          items: {
            include: { medicine: { select: { name: true, code: true } } },
          },
        },
      },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  })

  if (!invoice) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Normalise Decimal fields to numbers for the PDF component
  const data = {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.toISOString(),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
    subtotal: Number(invoice.subtotal),
    discountAmount: Number(invoice.discountAmount),
    taxAmount: Number(invoice.taxAmount),
    totalAmount: Number(invoice.totalAmount),
    status: invoice.status,
    notes: invoice.notes,
    retailer: {
      name: invoice.retailer.name,
      ownerName: invoice.retailer.ownerName,
      phone: invoice.retailer.phone,
      area: invoice.retailer.area?.name ?? null,
      address: invoice.retailer.address,
      drugLicenseNumber: invoice.retailer.drugLicenseNumber,
    },
    order: {
      orderNumber: invoice.order.orderNumber,
      items: invoice.order.items.map(item => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        offerPercent: Number(item.offerPercent),
        lineTotal: Number(item.lineTotal),
        medicine: { name: item.medicine.name, code: item.medicine.code },
      })),
    },
    payments: invoice.payments.map(p => ({
      id: p.id,
      amount: Number(p.amount),
      paymentDate: p.paymentDate.toISOString(),
      method: p.method,
      reference: p.reference,
    })),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(InvoicePDF, { invoice: data }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer = await renderToBuffer(element)

  const filename = `${invoice.invoiceNumber}.pdf`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    },
  })
}
