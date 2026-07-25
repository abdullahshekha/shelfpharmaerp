import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calcPurchasePrice, calcTradeOfferPercent } from '@/lib/utils/pricing'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const supplierId = searchParams.get('supplierId') ?? ''
  const status     = searchParams.get('status')     ?? ''
  const from       = searchParams.get('from')       ?? ''
  const to         = searchParams.get('to')         ?? ''
  const page       = parseInt(searchParams.get('page')     ?? '1')
  const pageSize   = parseInt(searchParams.get('pageSize') ?? '20')

  const where = {
    ...(supplierId && { supplierId }),
    ...(status     && { status }),
    ...((from || to) && {
      invoiceDate: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lt:  new Date(new Date(to).getTime() + 86400000) }),
      },
    }),
  }

  const [invoices, total] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where,
      include: {
        supplier: { select: { name: true, type: true } },
        _count: { select: { items: true } },
      },
      orderBy: { invoiceDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchaseInvoice.count({ where }),
  ])

  return NextResponse.json({ data: invoices, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
}

interface PurchaseInvoiceItemInput {
  medicineId: string
  batchNumber: string
  expiryDate: string
  quantity: number
  bonusQuantity?: number
  tradePrice: number
  mrp?: number | null
  discountPercent?: number
  salesTaxPercent?: number
  aitCollectiblePercent?: number
  aitPayablePercent?: number
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  if (!body.supplierId) return NextResponse.json({ error: 'Supplier required' }, { status: 400 })
  if (!body.items?.length) return NextResponse.json({ error: 'At least one item required' }, { status: 400 })

  const supplier = await prisma.supplier.findUnique({ where: { id: body.supplierId } })
  if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })

  const items: PurchaseInvoiceItemInput[] = body.items
  for (const item of items) {
    if (!item.medicineId || !item.batchNumber || !item.expiryDate || !item.quantity || !item.tradePrice) {
      return NextResponse.json(
        { error: 'Each item requires medicine, batch number, expiry date, quantity and trade price' },
        { status: 400 }
      )
    }
  }

  const medicines = await prisma.medicine.findMany({
    where: { id: { in: items.map((i) => i.medicineId) } },
    select: { id: true, salesTaxApplicable: true },
  })
  const medicineMap = new Map(medicines.map((m) => [m.id, m]))

  const computedItems = items.map((item) => {
    const medicine = medicineMap.get(item.medicineId)
    // Sales tax only applies if the medicine is flagged for it; AIT only applies if the supplier is a Filer.
    const salesTaxPercent = medicine?.salesTaxApplicable ? (item.salesTaxPercent ?? 0) : 0
    const aitCollectiblePercent = supplier.isFiler ? (item.aitCollectiblePercent ?? 0) : 0
    const aitPayablePercent = supplier.isFiler ? (item.aitPayablePercent ?? 0) : 0
    const discountPercent = item.discountPercent ?? 0
    const bonusQuantity = item.bonusQuantity ?? 0
    const totalQuantity = item.quantity + bonusQuantity

    // Bonus/free trade-offer stock is spread across all units received as an equivalent discount.
    const tradeOfferPercent = calcTradeOfferPercent(item.quantity, bonusQuantity)

    const purchasePrice = calcPurchasePrice({
      tradePrice: item.tradePrice,
      discountPercent: discountPercent + tradeOfferPercent,
      salesTaxPercent,
      aitCollectiblePercent,
      aitPayablePercent,
    })

    return {
      medicineId: item.medicineId,
      batchNumber: item.batchNumber,
      expiryDate: new Date(item.expiryDate),
      quantity: item.quantity,
      bonusQuantity,
      tradePrice: item.tradePrice,
      mrp: item.mrp ?? null,
      discountPercent,
      tradeOfferPercent,
      salesTaxPercent,
      aitCollectiblePercent,
      aitPayablePercent,
      purchasePrice,
      lineTotal: purchasePrice * totalQuantity,
      totalQuantity,
    }
  })

  const totalAmount = computedItems.reduce((sum, item) => sum + item.lineTotal, 0)
  const invoiceNumber = `SP-PUR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')}`

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseInvoice.create({
      data: {
        invoiceNumber,
        supplierId: body.supplierId,
        invoiceDate: new Date(body.invoiceDate ?? new Date()),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        totalAmount,
        status: 'UNPAID',
        notes: body.notes ?? null,
        items: {
          create: computedItems.map((item) => ({
            medicineId: item.medicineId,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate,
            quantity: item.quantity,
            bonusQuantity: item.bonusQuantity,
            tradePrice: item.tradePrice,
            mrp: item.mrp,
            discountPercent: item.discountPercent,
            tradeOfferPercent: item.tradeOfferPercent,
            salesTaxPercent: item.salesTaxPercent,
            aitCollectiblePercent: item.aitCollectiblePercent,
            aitPayablePercent: item.aitPayablePercent,
            purchasePrice: item.purchasePrice,
            lineTotal: item.lineTotal,
          })),
        },
      },
      include: { items: true },
    })

    // Receiving a purchase invoice is how new stock (a batch) enters inventory — actual + bonus quantity together.
    await tx.medicineBatch.createMany({
      data: computedItems.map((item) => ({
        medicineId: item.medicineId,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate,
        quantityIn: item.totalQuantity,
        currentQty: item.totalQuantity,
        purchasePrice: item.purchasePrice,
        tradePrice: item.tradePrice,
        mrp: item.mrp,
      })),
    })

    return created
  })

  return NextResponse.json({ data: invoice }, { status: 201 })
}
