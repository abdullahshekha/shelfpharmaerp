/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError } from '@/lib/accounting/core'
import { bad, loadRunDetail, lockRun, netPaisa, parseMoney } from '@/lib/accounting/payroll'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

// Body: { lines: [{ id, deduction, bonus, note? }], expectedUpdatedAt? }. DRAFT only. netPay is recomputed server-side.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON')
  }
  try {
    if (!body || !Array.isArray(body.lines) || body.lines.length === 0) bad('lines must be a non-empty list')
    const seen = new Set<string>()
    const edits = body.lines.map((l: any) => {
      if (!l || typeof l.id !== 'string' || !l.id) bad('Each line needs an id')
      if (seen.has(l.id)) bad('Duplicate line id')
      seen.add(l.id)
      if (l.note != null && typeof l.note !== 'string') bad('Invalid note')
      const note = typeof l.note === 'string' ? l.note.trim() : ''
      if (note.length > 300) bad('Note is too long')
      return { id: l.id as string, deduction: parseMoney(l.deduction, 'Deduction'), bonus: parseMoney(l.bonus, 'Bonus'), note: note || null }
    })
    if (body.expectedUpdatedAt !== undefined && (typeof body.expectedUpdatedAt !== 'string' || Number.isNaN(new Date(body.expectedUpdatedAt).getTime()))) bad('Invalid expectedUpdatedAt')

    await prisma.$transaction(
      async (tx) => {
        await lockRun(tx, id)
        const run = await tx.payrollRun.findUnique({ where: { id }, include: { lines: true } })
        if (!run) throw new AccountingError(404, 'Payroll run not found')
        if (run.status !== 'DRAFT') throw new AccountingError(409, 'Only a draft run can be edited — re-open it first')
        if (body.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== run.updatedAt.getTime()) throw new AccountingError(409, 'This run was changed by someone else — reload and try again')
        const byId = new Map(run.lines.map((l) => [l.id, l]))
        for (const e of edits) {
          const line = byId.get(e.id)
          if (!line) throw new AccountingError(400, 'A line does not belong to this run')
          const salary = Number(line.baseSalary)
          if (Math.round(e.deduction * 100) > Math.round(salary * 100)) throw new AccountingError(400, 'Deduction cannot exceed the base salary')
        }
        for (const e of edits) {
          const salary = Number(byId.get(e.id)!.baseSalary)
          await tx.payrollLine.update({ where: { id: e.id }, data: { deduction: e.deduction, bonus: e.bonus, note: e.note, netPay: netPaisa(salary, e.deduction, e.bonus) / 100 } })
        }
        await tx.payrollRun.update({ where: { id }, data: { status: 'DRAFT' } })
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: await loadRunDetail(prisma, id) })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}
