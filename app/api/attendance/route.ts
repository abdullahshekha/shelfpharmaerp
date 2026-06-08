import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const month = searchParams.get('month') ?? ''

  if (month) {
    const [year, m] = month.split('-').map(Number)
    const start = new Date(year, m - 1, 1)
    const end = new Date(year, m, 1)
    const records = await prisma.attendance.findMany({
      where: { date: { gte: start, lt: end } },
      include: { employee: { select: { id: true, name: true, role: true } } },
      orderBy: [{ date: 'asc' }, { employee: { name: 'asc' } }],
    })
    return NextResponse.json({ data: records })
  }

  const targetDate = new Date(date)
  const nextDay = new Date(targetDate.getTime() + 86400000)

  const [employees, existing] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: true } }),
    prisma.attendance.findMany({ where: { date: { gte: targetDate, lt: nextDay } }, include: { employee: { select: { name: true } } } }),
  ])

  return NextResponse.json({ data: { employees, attendance: existing, date } })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  // body: { records: [{employeeId, status, timeIn?, timeOut?}], date }

  const date = new Date(body.date)
  const results = []

  for (const record of body.records) {
    const att = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: record.employeeId, date } },
      update: {
        status: record.status,
        timeIn: record.timeIn ? new Date(record.timeIn) : null,
        timeOut: record.timeOut ? new Date(record.timeOut) : null,
        notes: record.notes ?? null,
      },
      create: {
        employeeId: record.employeeId,
        date,
        status: record.status ?? 'PRESENT',
        timeIn: record.timeIn ? new Date(record.timeIn) : null,
        timeOut: record.timeOut ? new Date(record.timeOut) : null,
        notes: record.notes ?? null,
      },
    })
    results.push(att)
  }

  return NextResponse.json({ data: results })
}
