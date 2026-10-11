/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { ensureChart } from '@/lib/accounting/accounts'
import { AccountingError, assertManualPostable, getSettings, postEntry, type LineInput } from '@/lib/accounting/core'
import { parseDateInput } from '@/lib/accounting/dates'
import { assetView, depreciationSummary, lockAsset } from '@/lib/accounting/assets'

export const dynamic = 'force-dynamic'

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

// Dr ACCUM_DEPRECIATION (accumulated so far) + Dr OTHER_EXPENSES (remaining book value) / Cr FIXED_ASSETS (cost).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON')
  }
  const date = parseDateInput(body?.date)
  if (!date) return fail('Invalid disposal date')
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await lockAsset(tx, id)
        const asset = await tx.fixedAsset.findUnique({ where: { id } })
        if (!asset) throw new AccountingError(404, 'Asset not found')
        if (asset.status === 'DISPOSED') throw new AccountingError(409, 'This asset is already disposed')
        assertManualPostable(await getSettings(tx), date)
        if (date.getTime() < asset.purchaseDate.getTime()) throw new AccountingError(400, 'Disposal date is before the purchase date')
        const dep = (await depreciationSummary(tx, [id])).get(id)
        if (dep?.last && date.getTime() < dep.last.getTime()) throw new AccountingError(400, `Disposal date is before the last depreciation entry (${dep.last.toISOString().slice(0, 10)})`)
        const chart = await ensureChart(tx)
        const costP = Math.round(Number(asset.cost) * 100)
        const accumP = dep?.paisa ?? 0
        const bookP = costP - accumP
        if (bookP < 0) throw new AccountingError(409, 'Accumulated depreciation exceeds cost — check the ledger')
        const lines: LineInput[] = []
        if (accumP > 0) lines.push({ accountId: chart.ACCUM_DEPRECIATION, debit: accumP / 100 })
        if (bookP > 0) lines.push({ accountId: chart.OTHER_EXPENSES, debit: bookP / 100 })
        lines.push({ accountId: chart.FIXED_ASSETS, credit: costP / 100 })
        const entry = await postEntry(tx, {
          date,
          memo: `Fixed asset disposal: ${asset.name}`,
          sourceType: 'ASSET_DISPOSAL',
          sourceId: id,
          isManual: false,
          createdById: auth.user.id,
          lines,
        })
        const updated = await tx.fixedAsset.update({ where: { id }, data: { status: 'DISPOSED', disposedAt: date } })
        return { asset: assetView(updated, dep), entry, writtenOff: bookP / 100 }
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: result })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}
