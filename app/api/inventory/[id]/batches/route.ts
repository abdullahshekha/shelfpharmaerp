import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleDelete } from '@/lib/utils/delete-approval'

export const dynamic = 'force-dynamic'

// Batches are created via Purchase Invoices, not directly on the item — see /api/purchase-invoices.

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const batchId = searchParams.get('batchId')
  if (!batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 })

  const batch = await prisma.medicineBatch.findUnique({
    where: { id: batchId, medicineId: id },
    select: { batchNumber: true, medicine: { select: { name: true } } },
  })
  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return handleDelete(req, 'MedicineBatch', batchId, `${batch.medicine.name} — Batch ${batch.batchNumber}`, async () => {
    await prisma.medicineBatch.delete({ where: { id: batchId, medicineId: id } })
  })
}
