import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const list = await prisma.offerList.findFirst({
    where: { isActive: true },
    include: { items: true },
  })
  return NextResponse.json({ data: list })
}
