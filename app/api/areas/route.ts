import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseSchedule } from '@/lib/utils/area-schedule'

export const dynamic = 'force-dynamic'

export async function GET() {
  const areas = await prisma.area.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json({ data: areas })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const schedule = parseSchedule(body)
  if (!schedule) return NextResponse.json({ error: 'Invalid delivery/booking days' }, { status: 400 })
  try {
    const area = await prisma.area.create({ data: { name: name.trim(), ...schedule } })
    return NextResponse.json({ data: area }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Area name already exists' }, { status: 409 })
  }
}
