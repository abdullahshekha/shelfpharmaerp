// Shared read-only handlers for the financial-report APIs (accounts + the Reports hub P&L wrapper).
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPaisa } from './money'
import { endExclusive, parseDateInput } from './dates'
import {
  trialBalance, profitAndLoss, balanceSheet, taxSummary, TAX_KEYS,
  type AccountSum, type ReportAccount, type TaxMonthSum,
} from './reports'

const bad = (error: string) => NextResponse.json({ error }, { status: 400 })

async function loadAccounts(): Promise<ReportAccount[]> {
  const rows = await prisma.account.findMany({ select: { id: true, code: true, name: true, type: true, subType: true, systemKey: true } })
  return rows as ReportAccount[]
}

async function goLive(): Promise<{ goLiveDate: string | null }> {
  const s = await prisma.accountingSettings.findFirst({ select: { goLiveDate: true } })
  return { goLiveDate: s?.goLiveDate ? s.goLiveDate.toISOString() : null }
}

/** Per-account debit/credit sums (paisa) for entries with from <= date < toExcl, grouped in the database. */
async function sumsBetween(from: Date | null, toExcl: Date | null): Promise<AccountSum[]> {
  const date: Prisma.DateTimeFilter = {}
  if (from) date.gte = from
  if (toExcl) date.lt = toExcl
  const groups = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: Object.keys(date).length ? { entry: { date } } : {},
    _sum: { debit: true, credit: true },
  })
  return groups.map((g) => ({
    accountId: g.accountId,
    debit: toPaisa(Number(g._sum.debit ?? 0)),
    credit: toPaisa(Number(g._sum.credit ?? 0)),
  }))
}

const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10) // Karachi calendar day
const monthStart = () => `${today().slice(0, 7)}-01`

function parseAsOf(sp: URLSearchParams): { asOf: string; toExcl: Date } | NextResponse {
  const asOf = sp.get('asOf') || today()
  const toExcl = endExclusive(asOf)
  if (!toExcl || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return bad('Invalid asOf date')
  return { asOf, toExcl }
}

function parseRange(sp: URLSearchParams): { from: string; to: string; fromD: Date; toExcl: Date } | NextResponse {
  const from = sp.get('from') || monthStart()
  const to = sp.get('to') || today()
  const fromD = /^\d{4}-\d{2}-\d{2}$/.test(from) ? parseDateInput(from) : null
  const toExcl = /^\d{4}-\d{2}-\d{2}$/.test(to) ? endExclusive(to) : null
  if (!fromD || !toExcl) return bad('Invalid from/to date')
  if (fromD >= toExcl) return bad('from must be on or before to')
  return { from, to, fromD, toExcl }
}

export async function trialBalanceHandler(sp: URLSearchParams) {
  const p = parseAsOf(sp)
  if (p instanceof NextResponse) return p
  const meta = await goLive()
  const accounts = await loadAccounts()
  const sums = meta.goLiveDate ? await sumsBetween(null, p.toExcl) : []
  return NextResponse.json({ data: trialBalance(accounts, sums, { includeZero: sp.get('includeZero') === '1' }), meta: { ...meta, asOf: p.asOf } })
}

export async function profitLossHandler(sp: URLSearchParams) {
  const p = parseRange(sp)
  if (p instanceof NextResponse) return p
  const meta = await goLive()
  const accounts = await loadAccounts()
  const sums = meta.goLiveDate ? await sumsBetween(p.fromD, p.toExcl) : []
  return NextResponse.json({ data: profitAndLoss(accounts, sums, { includeZero: sp.get('includeZero') === '1' }), meta: { ...meta, from: p.from, to: p.to } })
}

export async function balanceSheetHandler(sp: URLSearchParams) {
  const p = parseAsOf(sp)
  if (p instanceof NextResponse) return p
  const meta = await goLive()
  const accounts = await loadAccounts()
  const sums = meta.goLiveDate ? await sumsBetween(null, p.toExcl) : []
  return NextResponse.json({ data: balanceSheet(accounts, sums, { includeZero: sp.get('includeZero') === '1' }), meta: { ...meta, asOf: p.asOf } })
}

export async function taxHandler(sp: URLSearchParams) {
  const p = parseRange(sp)
  if (p instanceof NextResponse) return p
  const meta = await goLive()
  let sums: TaxMonthSum[] = []
  if (meta.goLiveDate) {
    // Karachi month = entry date shifted by +5h (entries are stored as UTC instants).
    const rows = await prisma.$queryRaw<{ month: string; key: string; d: Prisma.Decimal | null; c: Prisma.Decimal | null }[]>`
      SELECT to_char(e."date" + interval '5 hours', 'YYYY-MM') AS month, a."systemKey" AS key,
             SUM(l."debit") AS d, SUM(l."credit") AS c
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      JOIN "Account" a ON a."id" = l."accountId"
      WHERE a."systemKey" IN (${Prisma.join([...TAX_KEYS])})
        AND e."date" >= ${p.fromD} AND e."date" < ${p.toExcl}
      GROUP BY 1, 2`
    sums = rows.map((r) => ({ month: r.month, key: r.key, debit: toPaisa(Number(r.d ?? 0)), credit: toPaisa(Number(r.c ?? 0)) }))
  }
  return NextResponse.json({ data: taxSummary(sums), meta: { ...meta, from: p.from, to: p.to } })
}
