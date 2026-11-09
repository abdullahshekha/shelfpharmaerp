import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { canManageCheques, canAcknowledge } from '@/lib/pdc/guard'
import { canTransition, type ChequeStatus } from '@/lib/pdc/rules'
import { optStr } from '@/lib/pdc/create'
import { clearCheque, PdcError } from '@/lib/pdc/clear'
import { AccountingError } from '@/lib/accounting/core'
import { parseDateInput } from '@/lib/accounting/dates'

export const dynamic = 'force-dynamic'

const TARGET: Record<string, ChequeStatus> = { stop: 'STOPPED', return: 'RETURNED', represent: 'PENDING' }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  if (!user.id || !canManageCheques(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const action = body.action

  const cheque = await prisma.cheque.findUnique({ where: { id } })
  if (!cheque) return NextResponse.json({ error: 'Cheque not found' }, { status: 404 })
  const status = cheque.status as ChequeStatus

  if (action === 'acknowledge') {
    if (!canAcknowledge(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (cheque.acknowledgedAt) return NextResponse.json({ error: 'Already acknowledged' }, { status: 409 })
    const res = await prisma.cheque.updateMany({
      where: { id, acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), acknowledgedById: user.id },
    })
    if (res.count === 0) return NextResponse.json({ error: 'Cheque changed, reload and retry' }, { status: 409 })
    return NextResponse.json({ data: await prisma.cheque.findUnique({ where: { id } }) })
  }

  if (action === 'clear') {
    let clearingDate: Date | undefined
    if (body.clearingDate != null && body.clearingDate !== '') {
      const d = parseDateInput(body.clearingDate)
      if (!d) return NextResponse.json({ error: 'Invalid clearing date' }, { status: 400 })
      clearingDate = d
    }
    if (body.bankAccountId != null && body.bankAccountId !== '' && typeof body.bankAccountId !== 'string') {
      return NextResponse.json({ error: 'Invalid bank account' }, { status: 400 })
    }
    try {
      const result = await clearCheque(id, user, { clearingDate, bankAccountId: optStr(body.bankAccountId) ?? undefined })
      return NextResponse.json({ data: await prisma.cheque.findUnique({ where: { id } }), payments: result.payments })
    } catch (e) {
      if (e instanceof PdcError || e instanceof AccountingError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      if ((e as { code?: string })?.code === 'P2028') {
        return NextResponse.json({ error: 'The server is busy, please retry' }, { status: 503 })
      }
      console.error('clear cheque failed', e)
      return NextResponse.json({ error: 'Failed to clear cheque' }, { status: 500 })
    }
  }

  const to = typeof action === 'string' ? TARGET[action] : undefined
  if (!to) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  if (!canTransition(status, to)) {
    return NextResponse.json({ error: `Cannot ${action} a ${status} cheque` }, { status: 409 })
  }
  const note = optStr(body.notes)
  const res = await prisma.cheque.updateMany({
    where: { id, status },
    data: { status: to, ...(note ? { notes: note } : {}) },
  })
  if (res.count === 0) return NextResponse.json({ error: 'Cheque changed, reload and retry' }, { status: 409 })
  return NextResponse.json({ data: await prisma.cheque.findUnique({ where: { id } }) })
}
