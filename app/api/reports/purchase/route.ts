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
  const range = (from || to) ? {
    gte: from ? new Date(from) : undefined,
    lt: to ? new Date(new Date(to).getTime() + 86400000) : undefined,
  } : undefined

  const [invoices, returns] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where: range ? { invoiceDate: range } : {},
      include: {
        supplier: { select: { name: true } },
        items: { include: { medicine: { select: { name: true } } } },
      },
    }),
    prisma.supplierReturn.findMany({
      where: range ? { returnDate: range } : {},
      include: { supplier: { select: { name: true } } },
    }),
  ])

  const bySupplier = new Map<string, { name: string; invoices: number; amount: number }>()
  const byMedicine = new Map<string, { name: string; qty: number; amount: number }>()
  const byMonth = new Map<string, { month: string; invoices: number; amount: number }>()
  let total = 0, salesTax = 0, aitC = 0, aitP = 0

  for (const inv of invoices) {
    const amt = Number(inv.totalAmount)
    total += amt
    salesTax += Number(inv.salesTaxTotal)
    aitC += Number(inv.aitCollectibleTotal)
    aitP += Number(inv.aitPayableTotal)
    const s = bySupplier.get(inv.supplierId) ?? { name: inv.supplier.name, invoices: 0, amount: 0 }
    s.invoices += 1
    s.amount += amt
    bySupplier.set(inv.supplierId, s)
    const key = inv.invoiceDate.toISOString().slice(0, 7)
    const mo = byMonth.get(key) ?? { month: key, invoices: 0, amount: 0 }
    mo.invoices += 1
    mo.amount += amt
    byMonth.set(key, mo)
    for (const i of inv.items) {
      const m = byMedicine.get(i.medicineId) ?? { name: i.medicine.name, qty: 0, amount: 0 }
      m.qty += i.quantity + i.bonusQuantity
      m.amount += Number(i.lineTotal)
      byMedicine.set(i.medicineId, m)
    }
  }

  const retBySupplier = new Map<string, { name: string; returns: number; amount: number }>()
  let returnTotal = 0
  for (const r of returns) {
    const amt = Number(r.totalAmount)
    returnTotal += amt
    const s = retBySupplier.get(r.supplierId) ?? { name: r.supplier.name, returns: 0, amount: 0 }
    s.returns += 1
    s.amount += amt
    retBySupplier.set(r.supplierId, s)
  }

  const sortAmt = <T extends { amount: number }>(a: T, b: T) => b.amount - a.amount
  return NextResponse.json({
    data: {
      totals: { invoices: invoices.length, total, salesTax, aitCollectible: aitC, aitPayable: aitP },
      bySupplier: Array.from(bySupplier.values()).sort(sortAmt),
      byMedicine: Array.from(byMedicine.values()).sort(sortAmt),
      byMonth: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
      returns: {
        count: returns.length,
        total: returnTotal,
        bySupplier: Array.from(retBySupplier.values()).sort(sortAmt),
      },
    },
  })
}
