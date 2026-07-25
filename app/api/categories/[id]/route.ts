import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const existing = await prisma.category.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  try {
    const category = await prisma.category.update({ where: { id }, data: { name: name.trim() } })
    if (existing.name !== category.name) {
      await prisma.medicine.updateMany({ where: { category: existing.name }, data: { category: category.name } })
    }
    return NextResponse.json({ data: category })
  } catch {
    return NextResponse.json({ error: 'Name already exists' }, { status: 409 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const category = await prisma.category.findUnique({ where: { id } })
  if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  const count = await prisma.medicine.count({ where: { category: category.name } })
  if (count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} medicine(s) use this category. Reassign them first.` },
      { status: 409 }
    )
  }
  await prisma.category.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
