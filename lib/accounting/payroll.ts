/* eslint-disable @typescript-eslint/no-explicit-any */
// Payroll helpers.
//
// Ledger footprint of a run (isManual=false; not in sync.ts SOURCE_TYPES, so sync/rebuild never touch them):
//   PAYROLL          sourceId = run id   Dr SALARIES_EXPENSE (Σ net) / Cr SALARIES_PAYABLE (one line per employee, employeeId set)
//   PAYROLL_PAYMENT  sourceId = run id   Dr SALARIES_PAYABLE (one line per employee) / Cr cash-bank (Σ net)
//                    removed again by POST [id]/unpay (PAID -> POSTED) unless its date is locked / before go-live
// Every mutation of one run takes the same advisory lock `PAYROLL:<runId>`; run creation also locks `PAYROLL_MONTH:<month>`.
import { prisma } from '@/lib/prisma'
import { AccountingError, karachiDayKey } from './core'
import { toPaisa } from './money'
import { isValidMonth } from './depreciation'

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export const MAX_AMOUNT = 1e8

export const lockRun = (tx: Tx, id: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'PAYROLL:' + id}))`
export const lockMonth = (tx: Tx, month: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'PAYROLL_MONTH:' + month}))`

/** Salary deduction for absences: salary/30 per absent day, half of that per half day. Never below 0 or above salary. */
export function computeDeduction(salary: number, absentDays: number, halfDays: number): number {
  const salaryP = Math.max(0, toPaisa(salary))
  const units = Math.max(0, absentDays) + 0.5 * Math.max(0, halfDays)
  const p = Math.round((salaryP * units) / 30 + 1e-7)
  return Math.min(salaryP, Math.max(0, p)) / 100
}

export const netPaisa = (salary: number, deduction: number, bonus: number) => toPaisa(salary) - toPaisa(deduction) + toPaisa(bonus)

/** [start, endExclusive) of a YYYY-MM month as UTC midnights (Attendance.date is a @db.Date written from UTC-midnight dates). */
export function attendanceBounds(month: string): { start: Date; end: Date } {
  if (!isValidMonth(month)) throw new Error('Invalid month')
  const [y, m] = month.split('-').map(Number)
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }
}

/** YYYYMMDD of the first day of the month, for comparing with karachiDayKey. */
export const monthStartKey = (month: string) => month.replace('-', '') + '01'

export function joinedMidMonth(month: string, joiningDate: Date | null | undefined): boolean {
  return !!joiningDate && karachiDayKey(joiningDate) > monthStartKey(month)
}

/** Joined after the last day of the month (not employed yet). */
export function joinedAfterMonth(month: string, joiningDate: Date | null | undefined): boolean {
  if (!joiningDate) return false
  const [y, m] = month.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, 1))
  const nextKey = next.toISOString().slice(0, 10).replace(/-/g, '')
  return karachiDayKey(joiningDate) >= nextKey
}

export function bad(msg: string, status = 400): never {
  throw new AccountingError(status, msg)
}

export function parseMoney(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${label} must be a number`)
  if (v < 0) bad(`${label} cannot be negative`)
  if (v > MAX_AMOUNT) bad(`${label} must not exceed ${MAX_AMOUNT.toLocaleString('en-US')}`)
  return toPaisa(v) / 100
}

export function lineView(l: any, emp: any, month: string) {
  const base = Number(l.baseSalary)
  return {
    id: l.id,
    employeeId: l.employeeId,
    employeeName: emp?.name ?? '(deleted employee)',
    role: emp?.role ?? null,
    baseSalary: base,
    absentDays: Number(l.absentDays),
    halfDays: Number(l.halfDays),
    autoDeduction: computeDeduction(base, Number(l.absentDays), Number(l.halfDays)),
    deduction: Number(l.deduction),
    bonus: Number(l.bonus),
    netPay: Number(l.netPay),
    note: l.note ?? null,
    joinedMidMonth: joinedMidMonth(month, emp?.joiningDate),
  }
}

export function totalsOf(lines: { baseSalary: any; deduction: any; bonus: any; netPay: any }[]) {
  let s = 0, d = 0, b = 0, n = 0
  for (const l of lines) {
    s += toPaisa(Number(l.baseSalary)); d += toPaisa(Number(l.deduction)); b += toPaisa(Number(l.bonus)); n += toPaisa(Number(l.netPay))
  }
  return { count: lines.length, salary: s / 100, deduction: d / 100, bonus: b / 100, net: n / 100 }
}

/** Run + lines (with employee names) + its ledger entries, for the detail view. */
export async function loadRunDetail(db: typeof prisma | Tx, id: string) {
  const run = await db.payrollRun.findUnique({ where: { id }, include: { lines: { orderBy: { id: 'asc' } } } })
  if (!run) return null
  const emps = await db.employee.findMany({ where: { id: { in: run.lines.map((l) => l.employeeId) } }, select: { id: true, name: true, role: true, joiningDate: true } })
  const map = new Map(emps.map((e) => [e.id, e]))
  const lines = run.lines.map((l) => lineView(l, map.get(l.employeeId), run.month)).sort((a, b) => a.employeeName.localeCompare(b.employeeName))
  const entries = await db.journalEntry.findMany({
    where: { sourceType: { in: ['PAYROLL', 'PAYROLL_PAYMENT'] }, sourceId: id },
    select: { id: true, entryNumber: true, date: true, sourceType: true },
    orderBy: { date: 'asc' },
  })
  return {
    id: run.id,
    month: run.month,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    lines,
    totals: totalsOf(run.lines),
    entries,
  }
}
