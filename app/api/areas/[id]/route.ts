import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  try {
    const area = await prisma.area.update({ where: { id }, data: { name: name.trim() } })
    return NextResponse.json({ data: area })
  } catch {
    return NextResponse.json({ error: 'Name already exists or area not found' }, { status: 409 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const count = await prisma.retailer.count({ where: { areaId: id } })
  if (count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} retailer(s) are assigned to this area. Reassign them first.` },
      { status: 409 }
    )
  }
  await prisma.area.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
