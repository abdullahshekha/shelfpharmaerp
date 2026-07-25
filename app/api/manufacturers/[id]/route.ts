import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { name, contact } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  try {
    const manufacturer = await prisma.manufacturer.update({
      where: { id },
      data: { name: name.trim(), contact: contact?.trim() || null },
    })
    return NextResponse.json({ data: manufacturer })
  } catch {
    return NextResponse.json({ error: 'Name already exists or manufacturer not found' }, { status: 409 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const count = await prisma.medicine.count({ where: { manufacturerId: id } })
  if (count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} medicine(s) are assigned to this manufacturer. Reassign them first.` },
      { status: 409 }
    )
  }
  await prisma.manufacturer.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
