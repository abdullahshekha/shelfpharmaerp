import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const groups = await prisma.customerGroup.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { members: true } } },
  })
  return NextResponse.json({ data: groups })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const existing = await prisma.customerGroup.findUnique({ where: { name: body.name.trim() } })
  if (existing) return NextResponse.json({ error: 'A group with this name already exists' }, { status: 400 })

  const group = await prisma.customerGroup.create({ data: { name: body.name.trim() } })
  return NextResponse.json({ data: group }, { status: 201 })
}
