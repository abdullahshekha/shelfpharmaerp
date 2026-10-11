/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError, assertManualPostable, getSettings, postEntry } from '@/lib/accounting/core'
import { parseDateInput } from '@/lib/accounting/dates'
import { toPaisa } from '@/lib/accounting/money'

export const MAX_AMOUNT = 1e9
export const CASH_BANK_SUBTYPES = ['CASH', 'BANK']

type Kind = 'transfer' | 'expense' | 'receipt'

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

/** Shared handler for the three manual cash/bank postings. */
export async function postCashEntry(req: NextRequest, kind: Kind) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  let body: any
  try {
    body = await req.json()
  } catch {
    return bad('Invalid JSON')
  }
  if (!body || typeof body !== 'object') return bad('Invalid JSON')

  const idKeys = kind === 'transfer' ? ['fromAccountId', 'toAccountId'] : kind === 'expense' ? ['fromAccountId', 'expenseAccountId'] : ['toAccountId', 'sourceAccountId']
  for (const k of idKeys) if (typeof body[k] !== 'string' || !body[k]) return bad(`${k} is required`)
  const [x, y] = idKeys.map((k) => body[k] as string)
  if (x === y) return bad('The two accounts must be different')

  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) return bad('Amount must be a number')
  if (body.amount > MAX_AMOUNT) return bad(`Amount must not exceed ${MAX_AMOUNT.toLocaleString('en-US')}`)
  const paisa = toPaisa(body.amount)
  if (paisa <= 0) return bad('Amount must be greater than zero')
  const amount = paisa / 100

  const date = body.date ? parseDateInput(body.date) : new Date()
  if (!date) return bad('Invalid date')

  let sourceId: string | undefined
  if (body.requestId !== undefined && body.requestId !== null && body.requestId !== '') {
    if (typeof body.requestId !== 'string' || body.requestId.length > 100) return bad('Invalid requestId')
    sourceId = `req:${body.requestId}`
  }
  const memo = typeof body.memo === 'string' && body.memo.trim() ? body.memo.trim().slice(0, 500) : undefined

  const accs = await prisma.account.findMany({ where: { id: { in: [x, y] } } })
  const ax = accs.find((a) => a.id === x)
  const ay = accs.find((a) => a.id === y)
  if (!ax || !ay) return bad('Unknown account')
  if (!ax.isActive || !ay.isActive) return bad('An account is inactive')
  const isCB = (a: { subType: string | null; type: string }) => a.type === 'ASSET' && !!a.subType && CASH_BANK_SUBTYPES.includes(a.subType)
  if (!isCB(ax)) return bad(kind === 'receipt' ? 'The receiving account must be a cash or bank account' : 'The paying account must be a cash or bank account')
  if (kind === 'transfer') {
    if (!isCB(ay)) return bad('Both accounts must be cash or bank accounts')
  } else {
    if (isCB(ay)) return bad('Use a transfer between cash/bank accounts')
    if (ay.systemKey === 'AR' || ay.systemKey === 'AP') return bad('Receivable/payable accounts need a customer or supplier — use the Receivable/Payable tabs')
  }

  // Lines: transfer Dr y(to)/Cr x(from) with keys (from,to) ; expense Dr y / Cr x(from) ; receipt Dr x(to) / Cr y(source)
  const lines =
    kind === 'receipt'
      ? [{ accountId: x, debit: amount }, { accountId: y, credit: amount }]
      : [{ accountId: y, debit: amount }, { accountId: x, credit: amount }]
  // For transfer body is (fromAccountId, toAccountId) => x = from, y = to: Dr to, Cr from. Matches above.

  try {
    const entry = await prisma.$transaction(
      async (tx) => {
        assertManualPostable(await getSettings(tx), date)
        if (sourceId) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'MANUAL_CASH:' + sourceId}))`
          const dup = await tx.journalEntry.findFirst({ where: { sourceType: 'MANUAL_CASH', sourceId }, select: { id: true } })
          if (dup) throw new AccountingError(409, 'This entry was already submitted')
        }
        // Re-check accounts inside the transaction (could have been deactivated meanwhile).
        const fresh = await tx.account.count({ where: { id: { in: [x, y] }, isActive: true } })
        if (fresh !== 2) throw new AccountingError(400, 'An account is inactive')
        return postEntry(tx, {
          date,
          memo: memo ?? { transfer: 'Cash/bank transfer', expense: 'Expense / payment', receipt: 'Other receipt' }[kind],
          sourceType: 'MANUAL_CASH',
          sourceId,
          isManual: true,
          createdById: auth.user.id,
          lines,
        })
      },
      { maxWait: 10000, timeout: 15000 },
    )
    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    if (err instanceof AccountingError) return bad(err.message, err.status)
    throw err
  }
}
