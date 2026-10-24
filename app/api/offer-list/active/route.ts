import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getFefoBatch } from '@/lib/utils/pricing'

export const dynamic = 'force-dynamic'

export async function GET() {
  const list = await prisma.offerList.findFirst({
    where: { isActive: true },
    include: { items: true },
  })
  if (!list) return NextResponse.json({ data: list })

  const batches = await prisma.medicineBatch.findMany({
    where: { medicineId: { in: list.items.map((i) => i.medicineId) }, currentQty: { gt: 0 } },
    select: { medicineId: true, expiryDate: true, currentQty: true, tradePrice: true, mrp: true, salesTax: true },
  })
  const byMedicine = new Map<string, typeof batches>()
  for (const b of batches) {
    const arr = byMedicine.get(b.medicineId)
    if (arr) arr.push(b)
    else byMedicine.set(b.medicineId, [b])
  }
  const items = list.items.map((i) => {
    const fefo = getFefoBatch(byMedicine.get(i.medicineId) ?? [])
    return { ...i, fefoSalesTax: fefo?.salesTax != null ? Number(fefo.salesTax) : null }
  })
  return NextResponse.json({ data: { ...list, items } })
}
