/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError, assertManualPostable, assertNotLocked, getSettings } from '@/lib/accounting/core'
import { assetView, depreciationSummary, isValidFundingAccount, lockAsset, parseAssetBody, postAssetPurchase } from '@/lib/accounting/assets'

export const dynamic = 'force-dynamic'

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
type Ctx = { params: Promise<{ id: string }> }

function notLocked(settings: { lockedThrough: Date | null }, d: Date) {
  try {
    assertNotLocked(settings, d)
  } catch (e) {
    throw new AccountingError(409, (e as Error).message)
  }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const asset = await prisma.fixedAsset.findUnique({ where: { id } })
  if (!asset) return fail('Asset not found', 404)
  const dep = await depreciationSummary(prisma, [id])
  const entries = await prisma.journalEntry.findMany({
    where: { OR: [{ sourceType: { in: ['ASSET_PURCHASE', 'ASSET_DISPOSAL'] }, sourceId: id }, { sourceType: 'DEPRECIATION', sourceId: { startsWith: `${id}:` } }] },
    orderBy: [{ date: 'asc' }, { entryNumber: 'asc' }],
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
  })
  return NextResponse.json({ data: { ...assetView(asset, dep.get(id)), entries } })
}

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
    const f = parseAssetBody(body, true)
    const out = await prisma.$transaction(
      async (tx) => {
        await lockAsset(tx, id)
        const asset = await tx.fixedAsset.findUnique({ where: { id } })
        if (!asset) throw new AccountingError(404, 'Asset not found')
        const depCount = await tx.journalEntry.count({ where: { sourceType: 'DEPRECIATION', sourceId: { startsWith: `${id}:` } } })
        const financial =
          (f.purchaseDate !== undefined && f.purchaseDate.getTime() !== asset.purchaseDate.getTime()) ||
          (f.cost !== undefined && f.cost !== Number(asset.cost)) ||
          (f.salvageValue !== undefined && f.salvageValue !== Number(asset.salvageValue)) ||
          (f.usefulLifeMonths !== undefined && f.usefulLifeMonths !== asset.usefulLifeMonths) ||
          (f.paidFromAccountId !== undefined && f.paidFromAccountId !== asset.paidFromAccountId)
        const descriptive = { ...(f.name !== undefined ? { name: f.name } : {}), ...(f.category !== undefined ? { category: f.category } : {}), ...(f.notes !== undefined ? { notes: f.notes } : {}) }
        if (!financial) {
          return tx.fixedAsset.update({ where: { id }, data: descriptive })
        }
        if (asset.status !== 'ACTIVE') throw new AccountingError(409, 'A disposed asset can only have its name, category and notes edited')
        if (depCount > 0) throw new AccountingError(409, 'Depreciation has already been posted — only name, category and notes can be edited')
        const settings = await getSettings(tx)
        const next = {
          purchaseDate: f.purchaseDate ?? asset.purchaseDate,
          cost: f.cost ?? Number(asset.cost),
          salvageValue: f.salvageValue ?? Number(asset.salvageValue),
          usefulLifeMonths: f.usefulLifeMonths ?? asset.usefulLifeMonths,
          paidFromAccountId: f.paidFromAccountId ?? asset.paidFromAccountId,
        }
        if (next.salvageValue >= next.cost) throw new AccountingError(400, 'Salvage value must be less than the cost')
        if (!next.paidFromAccountId) throw new AccountingError(400, 'Funding account is required')
        assertManualPostable(settings, next.purchaseDate)
        notLocked(settings, asset.purchaseDate)
        const acc = await tx.account.findUnique({ where: { id: next.paidFromAccountId } })
        if (!acc) throw new AccountingError(400, 'Unknown funding account')
        const why = isValidFundingAccount(acc)
        if (why) throw new AccountingError(400, why)
        await tx.journalEntry.deleteMany({ where: { sourceType: 'ASSET_PURCHASE', sourceId: id } })
        const updated = await tx.fixedAsset.update({ where: { id }, data: { ...descriptive, ...next } })
        await postAssetPurchase(tx, updated, next.paidFromAccountId, auth.user.id)
        return updated
      },
      { maxWait: 10000, timeout: 15000 },
    )
    const dep = await depreciationSummary(prisma, [id])
    return NextResponse.json({ data: assetView(out, dep.get(id)) })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  try {
    await prisma.$transaction(
      async (tx) => {
        await lockAsset(tx, id)
        const asset = await tx.fixedAsset.findUnique({ where: { id } })
        if (!asset) throw new AccountingError(404, 'Asset not found')
        if (asset.status !== 'ACTIVE') throw new AccountingError(409, 'A disposed asset cannot be deleted')
        const depCount = await tx.journalEntry.count({ where: { sourceType: 'DEPRECIATION', sourceId: { startsWith: `${id}:` } } })
        if (depCount > 0) throw new AccountingError(409, 'Depreciation has been posted for this asset — it cannot be deleted (dispose it instead)')
        const entry = await tx.journalEntry.findFirst({ where: { sourceType: 'ASSET_PURCHASE', sourceId: id }, select: { date: true } })
        if (entry) notLocked(await getSettings(tx), entry.date)
        await tx.journalEntry.deleteMany({ where: { sourceType: 'ASSET_PURCHASE', sourceId: id } })
        await tx.fixedAsset.delete({ where: { id } })
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: { id } })
  } catch (err) {
    if (err instanceof AccountingError) return fail(err.message, err.status)
    throw err
  }
}
