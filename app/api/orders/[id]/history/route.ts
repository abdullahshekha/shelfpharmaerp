import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { orderRecordIds, orderHistoryWhere } from '@/lib/audit/query'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (getUserFromRequest(req).role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const ids = await orderRecordIds(id)
  const data = await prisma.auditLog.findMany({ where: orderHistoryWhere(id, ids), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return NextResponse.json({ data })
}
