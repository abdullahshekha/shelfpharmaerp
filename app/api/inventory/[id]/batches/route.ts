import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Batches are created via Purchase Invoices, not directly on the item — see /api/purchase-invoices.

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const batchId = searchParams.get('batchId')
  if (!batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 })

  await prisma.medicineBatch.delete({ where: { id: batchId, medicineId: id } })
  return NextResponse.json({ success: true })
}
