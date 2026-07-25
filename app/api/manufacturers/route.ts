import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const manufacturers = await prisma.manufacturer.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, contact: true, _count: { select: { medicines: true } } },
  })
  const data = manufacturers.map(m => ({ id: m.id, name: m.name, contact: m.contact, medicineCount: m._count.medicines }))
  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const { name, contact } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  try {
    const manufacturer = await prisma.manufacturer.create({ data: { name: name.trim(), contact: contact?.trim() || null } })
    return NextResponse.json({ data: manufacturer }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Manufacturer name already exists' }, { status: 409 })
  }
}
