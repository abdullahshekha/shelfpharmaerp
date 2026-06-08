import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  if (!body.batchNumber || !body.expiryDate || !body.quantityIn || !body.purchasePrice) {
    return NextResponse.json({ error: 'batchNumber, expiryDate, quantityIn and purchasePrice are required' }, { status: 400 })
  }

  const batch = await prisma.medicineBatch.create({
    data: {
      medicineId: id,
      batchNumber: body.batchNumber,
      expiryDate: new Date(body.expiryDate),
      quantityIn: parseInt(body.quantityIn),
      currentQty: parseInt(body.quantityIn),
      purchasePrice: parseFloat(body.purchasePrice),
    },
  })

  return NextResponse.json({ data: batch }, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const batchId = searchParams.get('batchId')
  if (!batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 })

  await prisma.medicineBatch.delete({ where: { id: batchId, medicineId: id } })
  return NextResponse.json({ success: true })
}
