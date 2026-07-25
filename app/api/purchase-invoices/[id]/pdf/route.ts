import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type ReactElement, type JSXElementConstructor } from 'react'
import { prisma } from '@/lib/prisma'
import { PurchaseInvoicePDF } from '@/components/purchase-invoices/PurchaseInvoicePDF'

export const dynamic = 'force-dynamic'
// Must run in Node.js runtime — @react-pdf/renderer uses Node APIs
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { medicine: { select: { name: true, code: true } } } },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  })

  if (!invoice) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const data = {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.toISOString(),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
    totalAmount: Number(invoice.totalAmount),
    salesTaxTotal: Number(invoice.salesTaxTotal),
    aitCollectibleTotal: Number(invoice.aitCollectibleTotal),
    aitPayableTotal: Number(invoice.aitPayableTotal),
    previousPayable: Number(invoice.previousPayable),
    grandTotal: Number(invoice.grandTotal),
    status: invoice.status,
    notes: invoice.notes,
    supplier: {
      name: invoice.supplier.name,
      type: invoice.supplier.type,
      contactPerson: invoice.supplier.contactPerson,
      phone: invoice.supplier.phone,
      address: invoice.supplier.address,
      ntnNumber: invoice.supplier.ntnNumber,
      strnNumber: invoice.supplier.strnStatus === 'REGISTERED' ? invoice.supplier.strnNumber : null,
    },
    items: invoice.items.map(item => ({
      id: item.id,
      quantity: item.quantity,
      bonusQuantity: item.bonusQuantity,
      batchNumber: item.batchNumber,
      expiryDate: item.expiryDate.toISOString(),
      tradePrice: Number(item.tradePrice),
      mrp: item.mrp != null ? Number(item.mrp) : null,
      discountPercent: Number(item.discountPercent),
      salesTax: Number(item.salesTax),
      purchasePrice: Number(item.purchasePrice),
      lineTotal: Number(item.lineTotal),
      medicine: { name: item.medicine.name, code: item.medicine.code },
    })),
    payments: invoice.payments.map(p => ({
      id: p.id,
      amount: Number(p.amount),
      paymentDate: p.paymentDate.toISOString(),
      method: p.method,
      reference: p.reference,
    })),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(PurchaseInvoicePDF, { invoice: data }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
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
