import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const manufacturers = await prisma.manufacturer.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
  return NextResponse.json({ data: manufacturers })
}
