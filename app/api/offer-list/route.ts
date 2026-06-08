import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const lists = await prisma.offerList.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { items: true } } },
  })
  return NextResponse.json({ data: lists })
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  // Auto-generate next list number
  const last = await prisma.offerList.findFirst({ orderBy: { listNumber: 'desc' } })
  const nextNum = last ? (parseInt(last.listNumber) + 1) : 1
  const listNumber = String(nextNum).padStart(6, '0')

  const list = await prisma.offerList.create({
    data: {
      listNumber,
      listDate: body.listDate ? new Date(body.listDate) : new Date(),
      createdBy: body.createdBy ?? null,
    },
  })

  return NextResponse.json({ data: list }, { status: 201 })
}
