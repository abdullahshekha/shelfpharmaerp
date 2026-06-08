import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      retailers: { select: { id: true, name: true, area: true } },
      attendance: { orderBy: { date: 'desc' }, take: 31 },
    },
  })
  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data: employee })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const employee = await prisma.employee.update({
    where: { id },
    data: {
      name: body.name,
      role: body.role,
      phone: body.phone ?? null,
      email: body.email ?? null,
      salary: body.salary ? Number(body.salary) : null,
      isActive: body.isActive ?? true,
    },
  })
  return NextResponse.json({ data: employee })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.employee.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ success: true })
}
