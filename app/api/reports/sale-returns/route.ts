import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!['ADMIN', 'MANAGER'].includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  const returns = await prisma.salesReturn.findMany({
    where: (from || to) ? {
      returnDate: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lt: new Date(new Date(to).getTime() + 86400000) }),
      },
    } : {},
    include: {
      retailer: { select: { name: true } },
      items: { include: { medicine: { select: { name: true } } } },
    },
  })

  const byCustomer = new Map<string, { name: string; returns: number; amount: number }>()
  const byMedicine = new Map<string, { name: string; qty: number; amount: number }>()
  const byReason = new Map<string, { reason: string; qty: number; amount: number }>()
  let totalAmount = 0
  let totalQty = 0

  for (const r of returns) {
    const amt = Number(r.totalAmount)
    totalAmount += amt
    const c = byCustomer.get(r.retailerId) ?? { name: r.retailer.name, returns: 0, amount: 0 }
    c.returns += 1
    c.amount += amt
    byCustomer.set(r.retailerId, c)
    for (const i of r.items) {
      const line = Number(i.lineTotal)
      totalQty += i.quantity
      const m = byMedicine.get(i.medicineId) ?? { name: i.medicine.name, qty: 0, amount: 0 }
      m.qty += i.quantity
      m.amount += line
      byMedicine.set(i.medicineId, m)
      const reason = i.reason ?? 'No reason given'
      const rs = byReason.get(reason) ?? { reason, qty: 0, amount: 0 }
      rs.qty += i.quantity
      rs.amount += line
      byReason.set(reason, rs)
    }
  }

  const sortAmt = <T extends { amount: number }>(a: T, b: T) => b.amount - a.amount
  return NextResponse.json({
    data: {
      totals: { returns: returns.length, qty: totalQty, amount: totalAmount },
      byCustomer: Array.from(byCustomer.values()).sort(sortAmt),
      byMedicine: Array.from(byMedicine.values()).sort(sortAmt),
      byReason: Array.from(byReason.values()).sort(sortAmt),
    },
  })
}
