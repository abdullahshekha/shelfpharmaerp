/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { ensureChart } from '@/lib/accounting/accounts'
import { assertNotLocked, getSettings, karachiDayKey, postEntry } from '@/lib/accounting/core'
import { parseDateInput } from '@/lib/accounting/dates'
import { depreciationPaisa, isValidMonth, lastDayOfMonth, monthDiff } from '@/lib/accounting/depreciation'
import { karachiMonth, lockAsset } from '@/lib/accounting/assets'

export const dynamic = 'force-dynamic'

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

type Row = { assetId: string; name: string; amount?: number; entryNumber?: string; reason?: string }

// Runs one month for every ACTIVE asset. Each asset is its own transaction (like sync), so one failure never
// blocks the rest, and re-running the same month never duplicates (sourceId `${assetId}:${YYYY-MM}`).
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
  const date = parseDateInput(lastDayOfMonth(month))!
  if (karachiDayKey(date) < karachiDayKey(settings0.goLiveDate)) {
    return NextResponse.json({ data: { month, date: lastDayOfMonth(month), posted: [], skipped: [], failed: [], totalPosted: 0, beforeGoLive: true, message: 'Month is entirely before the go-live date — nothing posted' } })
  }

  const assets = await prisma.fixedAsset.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } })
  const posted: Row[] = []
  const skipped: Row[] = []
  const failed: Row[] = []

  for (const a of assets) {
    const row = { assetId: a.id, name: a.name }
    const sourceId = `${a.id}:${month}`
    try {
      const res = await prisma.$transaction(
        async (tx) => {
          await lockAsset(tx, a.id)
          const fresh = await tx.fixedAsset.findUnique({ where: { id: a.id } })
          if (!fresh || fresh.status !== 'ACTIVE') return { skip: 'Asset is no longer active' }
          const dup = await tx.journalEntry.findFirst({ where: { sourceType: 'DEPRECIATION', sourceId }, select: { entryNumber: true } })
          if (dup) return { skip: `Already posted (${dup.entryNumber})` }
          const paisa = depreciationPaisa(
            { cost: Number(fresh.cost), salvageValue: Number(fresh.salvageValue), usefulLifeMonths: fresh.usefulLifeMonths, purchaseMonth: karachiMonth(fresh.purchaseDate) },
            month,
          )
          if (paisa <= 0) return { skip: 'Nothing to depreciate this month (not yet in service, fully depreciated, or no depreciable amount)' }
          const settings = await getSettings(tx)
          if (!settings.goLiveDate) return { skip: 'No go-live date' }
          try {
            assertNotLocked(settings, date)
          } catch {
            return { skip: 'Month is in a locked accounting period' }
          }
          const chart = await ensureChart(tx)
          const entry = await postEntry(tx, {
            date,
            memo: `Depreciation ${month}: ${fresh.name}`,
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
      if ('skip' in res) skipped.push({ ...row, reason: res.skip })
      else posted.push({ ...row, amount: res.amount, entryNumber: res.entryNumber })
    } catch (err) {
      failed.push({ ...row, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  const totalPosted = posted.reduce((s, r) => s + Math.round((r.amount ?? 0) * 100), 0) / 100
  return NextResponse.json({ data: { month, date: lastDayOfMonth(month), posted, skipped, failed, totalPosted } })
}
