import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const now = new Date()
  const startOfDay = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  startOfDay.setHours(0, 0, 0, 0)

  const tomorrow = new Date(startOfDay)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dayAfter = new Date(tomorrow)
  dayAfter.setDate(dayAfter.getDate() + 1)

  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [
    todayOrders,
    pendingWhatsapp,
    tomorrowDeliveries,
    lowStockMeds,
    nearExpiryBatches,
    outstandingSum,
  ] = await Promise.all([
    prisma.order.findMany({
      where: { orderDate: { gte: startOfDay, lt: tomorrow } },
      select: { id: true, totalAmount: true, status: true },
    }),
    prisma.whatsappOrder.count({ where: { status: 'AI_PROCESSED' } }),
    prisma.delivery.count({ where: { scheduledDate: { gte: tomorrow, lt: dayAfter }, status: 'SCHEDULED' } }),
    prisma.medicine.findMany({
      where: { isActive: true },
      include: { batches: { select: { currentQty: true } } },
      take: 20,
    }),
    prisma.medicineBatch.findMany({
      where: { expiryDate: { lte: thirtyDays }, currentQty: { gt: 0 } },
      include: { medicine: { select: { name: true, code: true } } },
      orderBy: { expiryDate: 'asc' },
      take: 10,
    }),
    prisma.invoice.aggregate({
      where: { status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
      _sum: { totalAmount: true },
    }),
  ])

  const todayTotal = todayOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0)

  const lowStock = lowStockMeds
    .map((m) => ({
      ...m,
      totalStock: m.batches.reduce((s, b) => s + b.currentQty, 0),
    }))
    .filter((m) => m.totalStock <= m.minStockLevel)
    .slice(0, 10)

  return NextResponse.json({
    data: {
      todayOrders: { count: todayOrders.length, total: todayTotal },
      pendingWhatsapp,
      tomorrowDeliveries,
      lowStock,
      nearExpiryBatches,
      outstandingReceivables: Number(outstandingSum._sum.totalAmount ?? 0),
    },
  })
}
