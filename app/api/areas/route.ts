import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const areas = await prisma.area.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json({ data: areas })
}

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  try {
    const area = await prisma.area.create({ data: { name: name.trim() } })
    return NextResponse.json({ data: area }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Area name already exists' }, { status: 409 })
  }
}
