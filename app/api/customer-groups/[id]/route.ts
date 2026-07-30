import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const group = await prisma.customerGroup.findUnique({
    where: { id },
    include: {
      members: {
        include: { retailer: { select: { id: true, name: true, phone: true, ownerName: true } } },
        orderBy: { retailer: { name: 'asc' } },
      },
    },
  })
  if (!group) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: group })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const group = await prisma.customerGroup.update({
    where: { id },
    data: { name: body.name.trim() },
  })
  return NextResponse.json({ data: group })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.customerGroup.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
