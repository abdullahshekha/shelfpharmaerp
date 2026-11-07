import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { buildAuditWhere, resolveSearchIds } from '@/lib/audit/query'
import { parseDateInput } from '@/lib/accounting/dates'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (getUserFromRequest(req).role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sp = req.nextUrl.searchParams
  const from = sp.get('from') || undefined
  const to = sp.get('to') || undefined
  if ((from && !parseDateInput(from)) || (to && !parseDateInput(to))) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
  }
  const q = sp.get('q')?.trim().slice(0, 200)
  const page = Math.min(100000, Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1))
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))
  const where = buildAuditWhere({
    actorId: sp.get('actorId') || undefined,
    model: sp.get('model') || undefined,
    action: sp.get('action') || undefined,
    from,
    to,
    recordIds: q ? await resolveSearchIds(q) : undefined,
  })
  const [total, data] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return NextResponse.json({ data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } })
}
