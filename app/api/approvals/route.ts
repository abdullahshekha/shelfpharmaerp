import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'PENDING'

  const approvals = await prisma.deleteApproval.findMany({
    where: { ...(status && { status }) },
    include: { requestedBy: { select: { name: true, role: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ data: approvals })
}
