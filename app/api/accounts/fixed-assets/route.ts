/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError, assertManualPostable, getSettings } from '@/lib/accounting/core'
import { assetView, depreciationSummary, isValidFundingAccount, lockAsset, parseAssetBody, postAssetPurchase, type AssetFields } from '@/lib/accounting/assets'

export const dynamic = 'force-dynamic'

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function GET(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const [assets, dep] = await Promise.all([
    prisma.fixedAsset.findMany({ orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }] }),
    depreciationSummary(prisma),
  ])
  const data = assets.map((a) => assetView(a, dep.get(a.id)))
  const active = data.filter((a) => a.status === 'ACTIVE')
  const meta = {
    count: data.length,
    totalCost: active.reduce((s, a) => s + Math.round(a.cost * 100), 0) / 100,
    totalAccumulated: active.reduce((s, a) => s + Math.round(a.accumulatedDepreciation * 100), 0) / 100,
    totalBookValue: active.reduce((s, a) => s + Math.round(a.bookValue * 100), 0) / 100,
  }
  return NextResponse.json({ data, meta })
}

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
    const f = parseAssetBody(body, false) as AssetFields
    let id: string | undefined
    if (body.requestId !== undefined && body.requestId !== null && body.requestId !== '') {
      if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.requestId)) return fail('Invalid requestId')
      id = `fa-${body.requestId}`
    }
    const asset = await prisma.$transaction(
      async (tx) => {
        assertManualPostable(await getSettings(tx), f.purchaseDate)
        if (id) {
          await lockAsset(tx, id)
          if (await tx.fixedAsset.findUnique({ where: { id }, select: { id: true } })) throw new AccountingError(409, 'This asset was already submitted')
        }
        const acc = await tx.account.findUnique({ where: { id: f.paidFromAccountId } })
        if (!acc) throw new AccountingError(400, 'Unknown funding account')
        const why = isValidFundingAccount(acc)
        if (why) throw new AccountingError(400, why)
        const created = await tx.fixedAsset.create({
          data: { ...(id ? { id } : {}), name: f.name, category: f.category, notes: f.notes, purchaseDate: f.purchaseDate, cost: f.cost, salvageValue: f.salvageValue, usefulLifeMonths: f.usefulLifeMonths, paidFromAccountId: f.paidFromAccountId },
        })
        await postAssetPurchase(tx, created, f.paidFromAccountId, auth.user.id)
        return created
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: assetView(asset) }, { status: 201 })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}
