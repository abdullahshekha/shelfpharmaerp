import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

const VALID_ROLES = ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'SALES_REP', 'WAREHOUSE', 'ACCOUNTANT']

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const role = searchParams.get('role') ?? ''

  const employees = await prisma.employee.findMany({
    where: {
      isActive: true,
      ...(role && { role }),
    },
    select: { id: true, name: true, role: true, phone: true, username: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ data: employees })
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const data: Parameters<typeof prisma.employee.create>[0]['data'] = {
    name: body.name,
    role: VALID_ROLES.includes(body.role) ? body.role : 'STAFF',
    phone: body.phone ?? null,
    email: body.email ?? null,
    cnic: body.cnic ?? null,
    salary: body.salary ?? null,
    joiningDate: body.joiningDate ? new Date(body.joiningDate) : null,
  }

  if (body.username) {
    data.username = body.username.trim()
    data.passwordHash = hashPassword(body.password ?? body.username)
  }

  const employee = await prisma.employee.create({ data })
  return NextResponse.json({ data: employee }, { status: 201 })
}
