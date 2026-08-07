import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, getUserFromRequest, canManageEmployees } from '@/lib/utils/auth'
import { handleDelete } from '@/lib/utils/delete-approval'

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
  // JSON.stringify (used internally by NextResponse.json) drops undefined-valued keys
  return NextResponse.json({ data: { ...employee, passwordHash: undefined } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!canManageEmployees(getUserFromRequest(req).role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()

  const data: Parameters<typeof prisma.employee.update>[0]['data'] = {
    name: body.name,
    role: body.role,
    phone: body.phone ?? null,
    email: body.email ?? null,
    cnic: body.cnic ?? null,
    salary: body.salary ? Number(body.salary) : null,
    joiningDate: body.joiningDate ? new Date(body.joiningDate) : null,
    isActive: body.isActive ?? true,
  }

  // loginBlocked is a standalone toggle — only touch it when explicitly sent
  if (body.loginBlocked !== undefined) data.loginBlocked = body.loginBlocked

  // username/password are optional — only touch them when the caller sends a value,
  // so editing other fields never accidentally clears existing login credentials
  if (body.username !== undefined) data.username = body.username?.trim() || null
  if (body.password) data.passwordHash = hashPassword(body.password)

  try {
    const employee = await prisma.employee.update({ where: { id }, data })
    return NextResponse.json({ data: employee })
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'P2002') {
      return NextResponse.json({ error: 'Username or CNIC already in use' }, { status: 400 })
    }
    throw e
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const employee = await prisma.employee.findUnique({ where: { id }, select: { name: true } })
  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return handleDelete(req, 'Employee', id, employee.name, async () => {
    await prisma.employee.update({ where: { id }, data: { isActive: false } })
  })
}
