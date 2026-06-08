import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
    include: {
      retailer: { select: { id: true, name: true, area: { select: { name: true } } } },
      payments: { select: { amount: true } },
    },
    orderBy: { invoiceDate: 'asc' },
  })

  const now = new Date()

  const buckets = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 }
  const byRetailer = new Map<string, {
    retailerId: string; retailerName: string; area: { name: string } | null
    current: number; days30: number; days60: number; days90: number; over90: number; total: number
  }>()

  for (const inv of invoices) {
    const totalPaid = inv.payments.reduce((s, p) => s + Number(p.amount), 0)
    const balance = Number(inv.totalAmount) - totalPaid
    if (balance <= 0) continue

    const dueDate = inv.dueDate ? new Date(inv.dueDate) : new Date(new Date(inv.invoiceDate).getTime() + 30 * 86400000)
    const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / 86400000)

    let bucket: keyof typeof buckets
    if (daysOverdue <= 0) bucket = 'current'
    else if (daysOverdue <= 30) bucket = 'days30'
    else if (daysOverdue <= 60) bucket = 'days60'
    else if (daysOverdue <= 90) bucket = 'days90'
    else bucket = 'over90'

    buckets[bucket] += balance

    const key = inv.retailer.id
    if (!byRetailer.has(key)) {
      byRetailer.set(key, {
        retailerId: inv.retailer.id,
        retailerName: inv.retailer.name,
        area: inv.retailer.area,
        current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0,
      })
    }
    const r = byRetailer.get(key)!
    r[bucket] += balance
    r.total += balance
  }

  const retailers = Array.from(byRetailer.values())
    .sort((a, b) => b.total - a.total)

  return NextResponse.json({ data: { totals: buckets, retailers } })
}
