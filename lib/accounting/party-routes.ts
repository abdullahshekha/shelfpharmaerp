/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from './guard'
import { AccountingError, assertManualPostable, getSettings, postEntry } from './core'
import { endExclusive, parseDateInput } from './dates'
import { toPaisa } from './money'
import { loadPartyBalances, SYSTEM_KEY, type PartyKind } from './parties'

export async function listParties(req: NextRequest, kind: PartyKind) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50') || 50))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0') || 0)
  const q = sp.get('search')?.trim().toLowerCase() ?? ''
  const nonZero = sp.get('nonZero') === '1' || sp.get('nonZero') === 'true'
  const onlyDiff = sp.get('diff') === '1' || sp.get('diff') === 'true'

  const [{ parties }, settings] = await Promise.all([loadPartyBalances(kind), getSettings(prisma)])
  const nz = (n: number) => Math.round(n * 100) !== 0

  // Totals/reconciliation are over every party, independent of search/paging, so the header never changes while typing.
  let ledgerTotal = 0, invoiceTotal = 0, differing = 0
  for (const p of parties) {
    ledgerTotal += toPaisa(p.ledger); invoiceTotal += toPaisa(p.invoice)
    if (nz(p.difference)) differing++
  }

  const filtered = parties
    .filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!nonZero || nz(p.ledger) || nz(p.invoice)) && (!onlyDiff || nz(p.difference)))
    .sort((a, b) => Math.abs(b.ledger) - Math.abs(a.ledger) || a.name.localeCompare(b.name))

  return NextResponse.json({
    data: filtered.slice(offset, offset + limit),
    meta: {
      total: filtered.length, limit, offset,
      totals: { ledger: ledgerTotal / 100, invoice: invoiceTotal / 100, difference: (ledgerTotal - invoiceTotal) / 100, differingParties: differing },
      goLiveDate: settings.goLiveDate,
      lockedThrough: settings.lockedThrough,
    },
  })
}

export async function partyStatement(req: NextRequest, kind: PartyKind, partyId: string) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const from = parseDateInput(sp.get('from'))
  const to = endExclusive(sp.get('to'))
  if ((sp.get('from') && !from) || (sp.get('to') && !to)) return NextResponse.json({ error: 'Invalid from/to date' }, { status: 400 })

  const party =
    kind === 'receivable'
      ? await prisma.retailer.findUnique({ where: { id: partyId }, select: { id: true, name: true } })
      : await prisma.supplier.findUnique({ where: { id: partyId }, select: { id: true, name: true } })
  if (!party) return NextResponse.json({ error: kind === 'receivable' ? 'Customer not found' : 'Supplier not found' }, { status: 404 })
  const account = await prisma.account.findUnique({ where: { systemKey: SYSTEM_KEY[kind] }, select: { id: true } })
  if (!account) return NextResponse.json({ error: 'System account missing' }, { status: 409 })

  const sign = kind === 'receivable' ? 1 : -1
  const base = { accountId: account.id, ...(kind === 'receivable' ? { retailerId: partyId } : { supplierId: partyId }) }

  let openingPaisa = 0
  if (from) {
    const s = await prisma.journalLine.aggregate({ where: { ...base, entry: { date: { lt: from } } }, _sum: { debit: true, credit: true } })
    openingPaisa = sign * (toPaisa(Number(s._sum.debit ?? 0)) - toPaisa(Number(s._sum.credit ?? 0)))
  }
  const lines = await prisma.journalLine.findMany({
    where: { ...base, entry: { date: { ...(from && { gte: from }), ...(to && { lt: to }) } } },
    include: { entry: { select: { id: true, entryNumber: true, date: true, memo: true, sourceType: true, sourceId: true, isManual: true, createdAt: true } } },
  })
  lines.sort((a, b) => a.entry.date.getTime() - b.entry.date.getTime() || a.entry.createdAt.getTime() - b.entry.createdAt.getTime() || a.id.localeCompare(b.id))

  let running = openingPaisa, totalDebit = 0, totalCredit = 0
  const rows = lines.map((l) => {
    const d = toPaisa(Number(l.debit)), c = toPaisa(Number(l.credit))
    totalDebit += d; totalCredit += c; running += sign * (d - c)
    return {
      lineId: l.id, entryId: l.entry.id, entryNumber: l.entry.entryNumber, date: l.entry.date,
      memo: l.entry.memo, lineMemo: l.memo, sourceType: l.entry.sourceType, sourceId: l.entry.sourceId, isManual: l.entry.isManual,
      debit: d / 100, credit: c / 100, balance: running / 100,
    }
  })

  const { parties } = await loadPartyBalances(kind)
  const bal = parties.find((p) => p.id === partyId)
  return NextResponse.json({
    data: {
      party, normal: sign === 1 ? 'DEBIT' : 'CREDIT',
      opening: openingPaisa / 100, totalDebit: totalDebit / 100, totalCredit: totalCredit / 100, closing: running / 100,
      ledgerBalance: bal?.ledger ?? 0, invoiceBalance: bal?.invoice ?? 0, difference: bal?.difference ?? 0,
      rows,
    },
  })
}

// Opening balance: manual entry dated on the go-live date. Customer: Dr AR[party] / Cr Opening Balance Equity.
// Supplier: Dr Opening Balance Equity / Cr AP[party].
export async function postOpeningBalance(req: NextRequest, kind: PartyKind) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const partyId = typeof body?.partyId === 'string' ? body.partyId : ''
  if (!partyId) return NextResponse.json({ error: kind === 'receivable' ? 'Choose a customer' : 'Choose a supplier' }, { status: 400 })
  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || toPaisa(amount) <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 })
  const exists = kind === 'receivable'
    ? await prisma.retailer.count({ where: { id: partyId } })
    : await prisma.supplier.count({ where: { id: partyId } })
  if (!exists) return NextResponse.json({ error: kind === 'receivable' ? 'Unknown customer' : 'Unknown supplier' }, { status: 400 })

  try {
    const entry = await prisma.$transaction(
      async (tx) => {
        const settings = await getSettings(tx)
        assertManualPostable(settings, settings.goLiveDate ?? new Date(0))
        const party = kind === 'receivable' ? { retailerId: partyId } : { supplierId: partyId }
        return postEntry(tx, {
          date: settings.goLiveDate!,
          memo: 'Opening balance',
          isManual: true,
          createdById: auth.user.id,
          lines:
            kind === 'receivable'
              ? [{ accountKey: 'AR', debit: amount, ...party }, { accountKey: 'OPENING_EQUITY', credit: amount }]
              : [{ accountKey: 'OPENING_EQUITY', debit: amount }, { accountKey: 'AP', credit: amount, ...party }],
        })
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    if (err instanceof AccountingError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
