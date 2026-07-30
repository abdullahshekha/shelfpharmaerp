import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  if (!body.retailerId) return NextResponse.json({ error: 'retailerId required' }, { status: 400 })

  const member = await prisma.customerGroupMember.upsert({
    where: { customerGroupId_retailerId: { customerGroupId: id, retailerId: body.retailerId } },
    update: {},
    create: { customerGroupId: id, retailerId: body.retailerId },
  })
  return NextResponse.json({ data: member }, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const retailerId = searchParams.get('retailerId')
  if (!retailerId) return NextResponse.json({ error: 'retailerId required' }, { status: 400 })

  await prisma.customerGroupMember.delete({
    where: { customerGroupId_retailerId: { customerGroupId: id, retailerId } },
  })
  return NextResponse.json({ success: true })
}
