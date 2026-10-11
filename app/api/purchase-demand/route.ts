import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT']

// Orders that have not been delivered yet have not consumed stock (stock is deducted at DELIVERED).
const PENDING_STATUSES = ['PENDING', 'CONFIRMED', 'PICKING', 'DISPATCHED']

// Reorder suggestions: suggested = max(0, pending demand + minStockLevel − current stock). Read-only.
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = (searchParams.get('search') ?? '').trim().toLowerCase()
  const supplierId = searchParams.get('supplierId') ?? ''

  const [medicines, pending, lastPurchases] = await Promise.all([
    prisma.medicine.findMany({
      where: { isActive: true },
      select: {
        id: true, code: true, name: true, genericName: true, minStockLevel: true,
        manufacturer: { select: { name: true } },
        batches: { select: { currentQty: true } },
      },
    }),
    prisma.orderItem.groupBy({
      by: ['medicineId'],
      where: { order: { status: { in: PENDING_STATUSES } } },
      _sum: { quantity: true },
    }),
    // Most recent purchase line per medicine = "last supplier / last price"
    prisma.purchaseInvoiceItem.findMany({
      orderBy: { purchaseInvoice: { invoiceDate: 'desc' } },
      select: {
        medicineId: true, purchasePrice: true,
        purchaseInvoice: { select: { supplierId: true, supplier: { select: { name: true } } } },
      },
    }),
  ])

  const pendingMap = new Map(pending.map(p => [p.medicineId, p._sum.quantity ?? 0]))
  const lastMap = new Map<string, (typeof lastPurchases)[number]>()
  for (const l of lastPurchases) if (!lastMap.has(l.medicineId)) lastMap.set(l.medicineId, l)

  const rows = []
  for (const m of medicines) {
    const stock = m.batches.reduce((s, b) => s + b.currentQty, 0)
    const pendingQty = pendingMap.get(m.id) ?? 0
    const suggested = Math.max(0, pendingQty + m.minStockLevel - stock)
    if (suggested <= 0) continue

    const last = lastMap.get(m.id)
    if (supplierId && last?.purchaseInvoice.supplierId !== supplierId) continue
    if (search && !`${m.name} ${m.genericName ?? ''} ${m.code} ${m.manufacturer?.name ?? ''}`.toLowerCase().includes(search)) continue

    const lastPrice = last ? Number(last.purchasePrice) : null
    rows.push({
      medicineId: m.id,
      code: m.code,
      name: m.name,
      manufacturer: m.manufacturer?.name ?? null,
      stock,
      minStockLevel: m.minStockLevel,
      pendingQty,
      suggestedQty: suggested,
      lastSupplierId: last?.purchaseInvoice.supplierId ?? null,
      lastSupplierName: last?.purchaseInvoice.supplier.name ?? null,
      lastPurchasePrice: lastPrice,
    })
  }

  rows.sort((a, b) => (a.lastSupplierName ?? '~').localeCompare(b.lastSupplierName ?? '~') || a.name.localeCompare(b.name))
  return NextResponse.json({ data: rows })
}
