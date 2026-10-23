import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncSafe } from '@/lib/accounting/sync'
import { getUserFromRequest } from '@/lib/utils/auth'
import { calcPurchasePrice, calcTradeOfferPercent, calcAitAmount, calcSalesTaxAmount } from '@/lib/utils/pricing'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { medicine: { select: { name: true, code: true, category: true, salesTaxApplicable: true } } } },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: invoice })
}

interface EditItemInput {
  id: string // existing PurchaseInvoiceItem.id — editing existing lines only, no add/remove
  batchNumber: string
  expiryDate: string
  quantity: number
  bonusQuantity?: number
  tradePrice: number
  mrp?: number | null
  discountPercent?: number
  salesTax?: number
  aitCollectiblePercent?: number
  aitPayablePercent?: number
}

// Admin-only edit of an already-submitted Purchase Invoice. Recomputes each line's tax/pricing
// with the exact same formulas as creation, and adjusts the batch that line created — matched via
// the stored batchId, or (for invoices predating that field) a best-effort match on
// (medicineId, batchNumber, expiryDate). Quantity changes are applied as a delta to the batch's
// currentQty so stock already sold/returned since isn't lost or double-counted; a reduction that
// would take currentQty negative (i.e. more has already been sold than the new quantity allows)
// is rejected rather than silently corrupting stock.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Only an Admin can edit a submitted Purchase Invoice' }, { status: 403 })
  }

  const body = await req.json()
  const editItems: EditItemInput[] = body.items ?? []

  const invoice = await prisma.purchaseInvoice.findUnique({
    where: { id },
    include: { supplier: true, items: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existingById = new Map(invoice.items.map((i) => [i.id, i]))
  for (const item of editItems) {
    if (!existingById.has(item.id)) {
      return NextResponse.json({ error: 'Adding or removing items is not supported — edit existing lines only' }, { status: 400 })
    }
    if (!item.batchNumber || !item.expiryDate || !item.quantity || !item.tradePrice) {
      return NextResponse.json({ error: 'Each item requires batch number, expiry date, quantity and trade price' }, { status: 400 })
    }
  }
  if (editItems.length !== invoice.items.length) {
    return NextResponse.json({ error: 'Adding or removing items is not supported — edit existing lines only' }, { status: 400 })
  }

  const medicines = await prisma.medicine.findMany({
    where: { id: { in: invoice.items.map((i) => i.medicineId) } },
    select: { id: true, salesTaxApplicable: true },
  })
  const medicineMap = new Map(medicines.map((m) => [m.id, m]))
  const warnings: string[] = []

  try {
    const result = await prisma.$transaction(async (tx) => {
      const computedItems = editItems.map((item) => {
        const existing = existingById.get(item.id)!
        const medicine = medicineMap.get(existing.medicineId)
        const salesTax = medicine?.salesTaxApplicable ? (item.salesTax ?? 0) : 0
        const aitCollectiblePercent = invoice.supplier.isFiler ? (item.aitCollectiblePercent ?? 0) : 0
        const aitPayablePercent = invoice.supplier.isFiler ? (item.aitPayablePercent ?? 0) : 0
        const discountPercent = item.discountPercent ?? 0
        const bonusQuantity = item.bonusQuantity ?? 0
        const totalQuantity = item.quantity + bonusQuantity
        const tradeOfferPercent = calcTradeOfferPercent(item.quantity, bonusQuantity)
        const purchasePrice = calcPurchasePrice({ tradePrice: item.tradePrice, discountPercent, tradeOfferPercent })

        return {
          existing,
          medicineId: existing.medicineId,
          batchNumber: item.batchNumber,
          expiryDate: new Date(item.expiryDate),
          quantity: item.quantity,
          bonusQuantity,
          totalQuantity,
          tradePrice: item.tradePrice,
          mrp: item.mrp ?? null,
          discountPercent,
          tradeOfferPercent,
          salesTax,
          salesTaxAmount: calcSalesTaxAmount(salesTax, totalQuantity),
          aitCollectiblePercent,
          aitPayablePercent,
          aitCollectibleAmount: calcAitAmount(item.tradePrice, aitCollectiblePercent, totalQuantity),
          aitPayableAmount: calcAitAmount(item.tradePrice, aitPayablePercent, totalQuantity),
          purchasePrice,
          lineTotal: purchasePrice * totalQuantity,
        }
      })

      for (const item of computedItems) {
        let batch = item.existing.batchId
          ? await tx.medicineBatch.findUnique({ where: { id: item.existing.batchId } })
          : null

        if (!batch) {
          const candidates = await tx.medicineBatch.findMany({
            where: {
              medicineId: item.existing.medicineId,
              batchNumber: item.existing.batchNumber,
              expiryDate: item.existing.expiryDate,
            },
          })
          if (candidates.length === 1) batch = candidates[0]
        }

        if (batch) {
          const oldTotalQuantity = item.existing.quantity + item.existing.bonusQuantity
          const delta = item.totalQuantity - oldTotalQuantity
          const newCurrentQty = batch.currentQty + delta
          if (newCurrentQty < 0) {
            throw new Error(
              `${item.batchNumber}: can't reduce quantity below what's already been sold/used from this batch (${batch.currentQty} of ${batch.quantityIn} remaining)`
            )
          }
          await tx.medicineBatch.update({
            where: { id: batch.id },
            data: {
              batchNumber: item.batchNumber,
              expiryDate: item.expiryDate,
              quantityIn: item.totalQuantity,
              currentQty: newCurrentQty,
              purchasePrice: item.purchasePrice,
              tradePrice: item.tradePrice,
              mrp: item.mrp,
              salesTax: item.salesTax,
              discountPercent: item.discountPercent,
              bonusQuantity: item.bonusQuantity,
            },
          })
          // Backfill the link for legacy items so future edits don't need the fallback match.
          if (!item.existing.batchId) {
            await tx.purchaseInvoiceItem.update({ where: { id: item.existing.id }, data: { batchId: batch.id } })
          }
        } else {
          warnings.push(`${item.existing.batchNumber} (${item.batchNumber}): couldn't find its stock batch to adjust — invoice line updated, but stock levels were not changed for this item`)
        }

        await tx.purchaseInvoiceItem.update({
          where: { id: item.existing.id },
          data: {
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate,
            quantity: item.quantity,
            bonusQuantity: item.bonusQuantity,
            tradePrice: item.tradePrice,
            mrp: item.mrp,
            discountPercent: item.discountPercent,
            tradeOfferPercent: item.tradeOfferPercent,
            salesTax: item.salesTax,
            salesTaxAmount: item.salesTaxAmount,
            aitCollectiblePercent: item.aitCollectiblePercent,
            aitPayablePercent: item.aitPayablePercent,
            aitCollectibleAmount: item.aitCollectibleAmount,
            aitPayableAmount: item.aitPayableAmount,
            purchasePrice: item.purchasePrice,
            lineTotal: item.lineTotal,
          },
        })
      }

      const subTotal = computedItems.reduce((s, i) => s + i.lineTotal, 0)
      const salesTaxTotal = computedItems.reduce((s, i) => s + i.salesTaxAmount, 0)
      const aitCollectibleTotal = computedItems.reduce((s, i) => s + i.aitCollectibleAmount, 0)
      const aitPayableTotal = computedItems.reduce((s, i) => s + i.aitPayableAmount, 0)
      const totalAmount = subTotal + salesTaxTotal - aitCollectibleTotal + aitPayableTotal
      const previousPayable = body.previousPayable != null ? Number(body.previousPayable) : Number(invoice.previousPayable)
      const grandTotal = totalAmount + previousPayable

      const payments = await tx.supplierPayment.findMany({ where: { purchaseInvoiceId: id } })
      const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0)
      const status = totalPaid >= totalAmount ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID'

      const updated = await tx.purchaseInvoice.update({
        where: { id },
        data: {
          invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : undefined,
          dueDate: body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate) : null) : undefined,
          notes: body.notes !== undefined ? body.notes : undefined,
          totalAmount,
          salesTaxTotal,
          aitCollectibleTotal,
          aitPayableTotal,
          previousPayable,
          grandTotal,
          status,
        },
        include: {
          supplier: true,
          items: { include: { medicine: { select: { name: true, code: true, category: true, salesTaxApplicable: true } } } },
          payments: { orderBy: { paymentDate: 'desc' } },
        },
      })

      return updated
    })

    await syncSafe('PURCHASE_INVOICE', id)

    return NextResponse.json({ data: result, warnings })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save changes' }, { status: 409 })
  }
}
