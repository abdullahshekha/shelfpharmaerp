/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError } from '@/lib/accounting/core'
import { isValidMonth, monthDiff } from '@/lib/accounting/depreciation'
import { karachiMonth } from '@/lib/accounting/assets'
import { attendanceBounds, bad, computeDeduction, joinedAfterMonth, loadRunDetail, lockMonth, netPaisa, totalsOf } from '@/lib/accounting/payroll'

export const dynamic = 'force-dynamic'

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function GET(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const runs = await prisma.payrollRun.findMany({ include: { lines: { select: { baseSalary: true, deduction: true, bonus: true, netPay: true } } }, orderBy: { month: 'desc' } })
  const data = runs.map((r) => ({ id: r.id, month: r.month, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, totals: totalsOf(r.lines) }))
  return NextResponse.json({ data })
}

// Creates a DRAFT run for one month from active employees with a salary (optionally only `employeeIds`).
export async function POST(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON')
  }
  try {
    const month = body?.month
    if (!isValidMonth(month)) bad('month must be YYYY-MM')
    if (monthDiff(karachiMonth(new Date()), month) > 0) bad('Cannot create payroll for a future month')
    let ids: string[] | null = null
    if (body.employeeIds !== undefined && body.employeeIds !== null) {
      if (!Array.isArray(body.employeeIds) || body.employeeIds.length === 0 || body.employeeIds.some((x: unknown) => typeof x !== 'string' || !x)) bad('employeeIds must be a non-empty list of employee ids')
      ids = Array.from(new Set<string>(body.employeeIds))
    }
    const id = await prisma.$transaction(
      async (tx) => {
        await lockMonth(tx, month)
        if (await tx.payrollRun.findUnique({ where: { month }, select: { id: true } })) throw new AccountingError(409, `A payroll run for ${month} already exists`)
        const emps = await tx.employee.findMany({
          where: { isActive: true, salary: { gt: 0 }, ...(ids ? { id: { in: ids } } : {}) },
          select: { id: true, salary: true, joiningDate: true },
        })
        if (ids) {
          const missing = ids.filter((i) => !emps.some((e) => e.id === i))
          if (missing.length) throw new AccountingError(400, 'Some selected employees are not active or have no salary')
        }
        const eligible = ids ? emps : emps.filter((e) => !joinedAfterMonth(month, e.joiningDate))
        if (eligible.length === 0) throw new AccountingError(400, 'No active employees with a salary to include')
        const { start, end } = attendanceBounds(month)
        const att = await tx.attendance.groupBy({
          by: ['employeeId', 'status'],
          where: { employeeId: { in: eligible.map((e) => e.id) }, date: { gte: start, lt: end }, status: { in: ['ABSENT', 'HALF_DAY'] } },
          _count: { _all: true },
        })
        const count = (eid: string, st: string) => att.find((a) => a.employeeId === eid && a.status === st)?._count._all ?? 0
        const lines = eligible.map((e) => {
          const salary = Number(e.salary)
          const absent = count(e.id, 'ABSENT')
          const half = count(e.id, 'HALF_DAY')
          const ded = computeDeduction(salary, absent, half)
          return { employeeId: e.id, baseSalary: salary, absentDays: absent, halfDays: half, deduction: ded, bonus: 0, netPay: netPaisa(salary, ded, 0) / 100 }
        })
        const run = await tx.payrollRun.create({ data: { month, lines: { create: lines } } })
        return run.id
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: await loadRunDetail(prisma, id) }, { status: 201 })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}
