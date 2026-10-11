import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

const DAY = 86400000

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!['ADMIN', 'MANAGER'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const medicines = await prisma.medicine.findMany({
    where: { isActive: true },
    select: {
      id: true, code: true, name: true, minStockLevel: true,
      manufacturer: { select: { name: true } },
      batches: {
        where: { currentQty: { gt: 0 } },
        select: { batchNumber: true, expiryDate: true, currentQty: true, purchasePrice: true, tradePrice: true },
      },
    },
  })

  const now = Date.now()
  const valuationRows: { code: string; name: string; manufacturer: string; qty: number; costValue: number; tradeValue: number }[] = []
  const lowStock: { code: string; name: string; manufacturer: string; stock: number; minStockLevel: number }[] = []
  const expiry: { code: string; name: string; batchNumber: string; expiryDate: string; daysLeft: number; qty: number; costValue: number; expired: boolean }[] = []

  for (const m of medicines) {
    const mfr = m.manufacturer?.name ?? 'Unknown'
    let qty = 0, cost = 0, trade = 0
    for (const b of m.batches) {
      const pp = Number(b.purchasePrice), tp = Number(b.tradePrice)
      qty += b.currentQty
      cost += b.currentQty * pp
      trade += b.currentQty * tp
      const daysLeft = Math.floor((b.expiryDate.getTime() - now) / DAY)
      if (daysLeft <= 90) {
        expiry.push({
          code: m.code, name: m.name, batchNumber: b.batchNumber,
          expiryDate: b.expiryDate.toISOString(), daysLeft, qty: b.currentQty,
          costValue: b.currentQty * pp, expired: daysLeft < 0,
        })
      }
    }
    if (qty > 0) valuationRows.push({ code: m.code, name: m.name, manufacturer: mfr, qty, costValue: cost, tradeValue: trade })
    if (qty <= m.minStockLevel) lowStock.push({ code: m.code, name: m.name, manufacturer: mfr, stock: qty, minStockLevel: m.minStockLevel })
  }

  const byMfr = new Map<string, { manufacturer: string; qty: number; costValue: number; tradeValue: number; items: typeof valuationRows }>()
  for (const r of valuationRows) {
    const g = byMfr.get(r.manufacturer) ?? { manufacturer: r.manufacturer, qty: 0, costValue: 0, tradeValue: 0, items: [] }
    g.qty += r.qty
    g.costValue += r.costValue
    g.tradeValue += r.tradeValue
    g.items.push(r)
    byMfr.set(r.manufacturer, g)
  }
  const groups = Array.from(byMfr.values()).sort((a, b) => b.costValue - a.costValue)
  for (const g of groups) g.items.sort((a, b) => b.costValue - a.costValue)

  expiry.sort((a, b) => a.daysLeft - b.daysLeft)
  lowStock.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))

  return NextResponse.json({
    data: {
      valuation: {
        totals: {
          medicines: valuationRows.length,
          qty: valuationRows.reduce((s, r) => s + r.qty, 0),
          costValue: valuationRows.reduce((s, r) => s + r.costValue, 0),
          tradeValue: valuationRows.reduce((s, r) => s + r.tradeValue, 0),
        },
        byManufacturer: groups,
      },
      lowStock,
      expiry: {
        expiredCount: expiry.filter(e => e.expired).length,
        expiredValue: expiry.filter(e => e.expired).reduce((s, e) => s + e.costValue, 0),
        soonValue: expiry.filter(e => !e.expired).reduce((s, e) => s + e.costValue, 0),
        batches: expiry,
      },
    },
  })
}
