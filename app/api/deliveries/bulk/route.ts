import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

// Assign (or clear) the driver on many deliveries at once. ADMIN/MANAGER only.
export async function PUT(req: NextRequest) {
  if (!requireRole(req, 'ADMIN', 'MANAGER')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { ids, driverId } = await req.json()
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== 'string')) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  }
  const r = await prisma.delivery.updateMany({ where: { id: { in: ids } }, data: { driverId: driverId || null } })
  return NextResponse.json({ updated: r.count })
}
