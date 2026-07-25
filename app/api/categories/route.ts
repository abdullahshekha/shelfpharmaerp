import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } })
  const counts = await prisma.medicine.groupBy({ by: ['category'], _count: { category: true } })
  const countMap = new Map(counts.map(c => [c.category, c._count.category]))
  const data = categories.map(c => ({ ...c, medicineCount: countMap.get(c.name) ?? 0 }))
  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  try {
    const category = await prisma.category.create({ data: { name: name.trim() } })
    return NextResponse.json({ data: category }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Category name already exists' }, { status: 409 })
  }
}
