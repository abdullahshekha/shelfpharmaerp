/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { ensureChart } from '@/lib/accounting/accounts'
import { assertNotLocked, getSettings, karachiDayKey, postEntry } from '@/lib/accounting/core'
import { parseDateInput } from '@/lib/accounting/dates'
import { catchUpMonths, depreciationPaisa, isValidMonth, lastDayOfMonth, monthDiff } from '@/lib/accounting/depreciation'
import { depreciationSummary, karachiMonth, lockAsset } from '@/lib/accounting/assets'

export const dynamic = 'force-dynamic'

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

type Row = { assetId: string; name: string; month: string; amount?: number; entryNumber?: string; reason?: string }
type MonthSummary = { month: string; date: string; posted: number; skipped: number; failed: number; totalPosted: number }

export const maxDuration = 60
const TIME_BUDGET_MS = 25_000

// Catch-up run: for every ACTIVE asset posts each missing month from its first depreciation month (the purchase
// month, never before the go-live month) through the requested month. Each asset-month is its own transaction
// (like sync), so one failure never blocks the rest, and re-running never duplicates (sourceId `${assetId}:${YYYY-MM}`).
// Each entry is dated its own month-end; months in a locked period are skipped and reported. If the time budget
// runs out the response says so (`incomplete`) and the same request can simply be repeated.
export async function POST(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON')
  }
  const month = body?.month
  if (!isValidMonth(month)) return fail('month must be YYYY-MM')
  if (monthDiff(karachiMonth(new Date()), month) > 0) return fail('Cannot run depreciation for a future month')

  const settings0 = await getSettings(prisma)
  if (!settings0.goLiveDate) return fail('Set a go-live date in Accounts Settings before posting depreciation', 409)
  const goLiveMonth = karachiMonth(settings0.goLiveDate)
  if (monthDiff(goLiveMonth, month) < 0) {
    return NextResponse.json({ data: { month, date: lastDayOfMonth(month), posted: [], skipped: [], failed: [], months: [], totalPosted: 0, beforeGoLive: true, message: 'Month is entirely before the go-live date — nothing posted' } })
  }

  const started = Date.now()
  const assets = await prisma.fixedAsset.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } })
  const existing = new Set(
    (await prisma.journalEntry.findMany({ where: { sourceType: 'DEPRECIATION' }, select: { sourceId: true } })).map((e) => e.sourceId as string),
  )
  const posted: Row[] = []
  const skipped: Row[] = []
  const failed: Row[] = []
  const byMonth = new Map<string, MonthSummary>()
  const bucket = (m: string) => {
    let b = byMonth.get(m)
    if (!b) byMonth.set(m, (b = { month: m, date: lastDayOfMonth(m), posted: 0, skipped: 0, failed: 0, totalPosted: 0 }))
    return b
  }
  let incomplete = false

  outer: for (const a of assets) {
    const months = catchUpMonths(
      { purchaseMonth: karachiMonth(a.purchaseDate), usefulLifeMonths: a.usefulLifeMonths, cost: Number(a.cost), salvageValue: Number(a.salvageValue), openingAccumulated: Number(a.openingAccumulated) },
      goLiveMonth,
      month,
    )
    if (months.length === 0) {
      skipped.push({ assetId: a.id, name: a.name, month, reason: 'Nothing to depreciate this month (not yet in service, fully depreciated, or no depreciable amount)' })
      bucket(month).skipped++
      continue
    }
    if (!months.includes(month)) {
      // Past its useful life: earlier months are caught up below, but say why nothing is posted for the requested month.
      skipped.push({ assetId: a.id, name: a.name, month, reason: 'Fully depreciated before this month' })
      bucket(month).skipped++
    }
    for (const m of months) {
      const row = { assetId: a.id, name: a.name, month: m }
      const sourceId = `${a.id}:${m}`
      if (existing.has(sourceId)) {
        // Cheap path for the common re-run; the transaction below re-checks authoritatively for races.
        // Earlier catch-up months that are already done are only counted (months[]), not listed one by one.
        if (m === month) skipped.push({ ...row, reason: 'Already posted' })
        bucket(m).skipped++
        continue
      }
      if (Date.now() - started > TIME_BUDGET_MS) { incomplete = true; break outer }
      const date = parseDateInput(lastDayOfMonth(m))!
      try {
        const res = await prisma.$transaction(
          async (tx) => {
            await lockAsset(tx, a.id)
            const fresh = await tx.fixedAsset.findUnique({ where: { id: a.id } })
            if (!fresh || fresh.status !== 'ACTIVE') return { skip: 'Asset is no longer active' }
            const dup = await tx.journalEntry.findFirst({ where: { sourceType: 'DEPRECIATION', sourceId }, select: { entryNumber: true } })
            if (dup) return { skip: `Already posted (${dup.entryNumber})` }
            // Cap: opening accumulated + everything already posted + this month <= cost - salvage.
            const postedPaisa = (await depreciationSummary(tx, [a.id])).get(a.id)?.paisa ?? 0
            const paisa = depreciationPaisa(
              {
                cost: Number(fresh.cost),
                salvageValue: Number(fresh.salvageValue),
                usefulLifeMonths: fresh.usefulLifeMonths,
                purchaseMonth: karachiMonth(fresh.purchaseDate),
                openingAccumulated: Number(fresh.openingAccumulated),
              },
              m,
              postedPaisa,
            )
            if (paisa <= 0) return { skip: 'Nothing to depreciate this month (not yet in service, fully depreciated, or no depreciable amount)' }
            const settings = await getSettings(tx)
            if (!settings.goLiveDate) return { skip: 'No go-live date' }
            if (karachiDayKey(date) < karachiDayKey(settings.goLiveDate)) return { skip: 'Month is before the go-live date' }
            try {
              assertNotLocked(settings, date)
            } catch {
              return { skip: 'Month is in a locked accounting period' }
            }
            const chart = await ensureChart(tx)
            const entry = await postEntry(tx, {
              date,
              memo: `Depreciation ${m}: ${fresh.name}`,
              sourceType: 'DEPRECIATION',
              sourceId,
              isManual: false,
              createdById: auth.user.id,
              lines: [
                { accountId: chart.DEPRECIATION_EXPENSE, debit: paisa / 100 },
                { accountId: chart.ACCUM_DEPRECIATION, credit: paisa / 100 },
              ],
            })
            return { entryNumber: entry.entryNumber, amount: paisa / 100 }
          },
          { maxWait: 10000, timeout: 15000 },
        )
        if ('skip' in res) { skipped.push({ ...row, reason: res.skip }); bucket(m).skipped++ }
        else {
          posted.push({ ...row, amount: res.amount, entryNumber: res.entryNumber })
          const b = bucket(m); b.posted++; b.totalPosted = Math.round(b.totalPosted * 100 + res.amount * 100) / 100
        }
      } catch (err) {
        failed.push({ ...row, reason: err instanceof Error ? err.message : String(err) })
        bucket(m).failed++
      }
    }
  }

  const totalPosted = posted.reduce((s, r) => s + Math.round((r.amount ?? 0) * 100), 0) / 100
  const months = Array.from(byMonth.values()).sort((x, y) => x.month.localeCompare(y.month))
  return NextResponse.json({
    data: {
      month, date: lastDayOfMonth(month), posted, skipped, failed, months, totalPosted,
      ...(incomplete ? { incomplete: true, message: 'Stopped early to stay within the time limit — run it again to continue.' } : {}),
    },
  })
}
