import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') ?? ''
  const to   = searchParams.get('to')   ?? ''

  const now = new Date()
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const dateFrom = from ? new Date(from) : defaultFrom
  const dateTo   = to   ? new Date(new Date(to).getTime() + 86400000) : undefined

  const orders = await prisma.order.findMany({
    where: {
      orderDate: { gte: dateFrom, ...(dateTo && { lt: dateTo }) },
      status: { not: 'CANCELLED' },
    },
    select: { orderDate: true, totalAmount: true, retailerId: true, salesRepId: true },
  })

  // Monthly buckets — cover the selected range
  const bucketStart = from ? new Date(from) : defaultFrom
  const bucketEnd   = to   ? new Date(to)   : now
  const monthMap = new Map<string, { month: string; orders: number; revenue: number }>()

  // Iterate months in the selected range
  const cur = new Date(bucketStart.getFullYear(), bucketStart.getMonth(), 1)
  while (cur <= bucketEnd) {
    const key   = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`
    const label = cur.toLocaleString('en-PK', { month: 'short', year: '2-digit' })
    monthMap.set(key, { month: label, orders: 0, revenue: 0 })
    cur.setMonth(cur.getMonth() + 1)
  }

  for (const o of orders) {
    const d = new Date(o.orderDate)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = monthMap.get(key)
    if (bucket) { bucket.orders++; bucket.revenue += Number(o.totalAmount) }
  }
  const monthlySales = Array.from(monthMap.values())

  // Top retailers — within the selected range
  const rangeStart = from ? new Date(from) : startOfMonth
  const rangeOrders = orders.filter(o => new Date(o.orderDate) >= rangeStart)

  const retailerTotals = new Map<string, number>()
  for (const o of rangeOrders) {
    retailerTotals.set(o.retailerId, (retailerTotals.get(o.retailerId) ?? 0) + Number(o.totalAmount))
  }
  const topRetailerIds = Array.from(retailerTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0])
  const topRetailers = await Promise.all(
    topRetailerIds.map(async id => ({
      name: (await prisma.retailer.findUnique({ where: { id }, select: { name: true } }))?.name ?? id,
      revenue: retailerTotals.get(id) ?? 0,
    }))
  )

  // Top medicines — within range
  const monthItems = await prisma.orderItem.findMany({
    where: {
      order: {
        orderDate: { gte: rangeStart, ...(dateTo && { lt: dateTo }) },
        status: { not: 'CANCELLED' },
      },
    },
    include: { medicine: { select: { name: true } } },
  })
  const medQty = new Map<string, { name: string; qty: number; revenue: number }>()
  for (const item of monthItems) {
    const existing = medQty.get(item.medicineId) ?? { name: item.medicine.name, qty: 0, revenue: 0 }
    existing.qty     += item.quantity
    existing.revenue += Number(item.lineTotal)
    medQty.set(item.medicineId, existing)
  }
  const topMedicines = Array.from(medQty.values()).sort((a, b) => b.qty - a.qty).slice(0, 10)

  // Sales rep performance — within range
  const repTotals = new Map<string, { orders: number; revenue: number }>()
  for (const o of rangeOrders) {
    if (!o.salesRepId) continue
    const existing = repTotals.get(o.salesRepId) ?? { orders: 0, revenue: 0 }
    existing.orders++
    existing.revenue += Number(o.totalAmount)
    repTotals.set(o.salesRepId, existing)
  }
  const repIds = Array.from(repTotals.keys())
  const reps = await Promise.all(
    repIds.map(async id => ({
      name: (await prisma.employee.findUnique({ where: { id }, select: { name: true } }))?.name ?? id,
      orders: repTotals.get(id)!.orders,
      revenue: repTotals.get(id)!.revenue,
    }))
  )
  reps.sort((a, b) => b.revenue - a.revenue)

  return NextResponse.json({ data: { monthlySales, topRetailers, topMedicines, salesReps: reps } })
}
