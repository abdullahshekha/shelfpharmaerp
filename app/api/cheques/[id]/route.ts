import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { parseDateInput } from '@/lib/accounting/dates'
import { canManageCheques, canEditCheque, canEditParty } from '@/lib/pdc/guard'
import { assertBankAccount, resolveParty, parseChequeAmount, optStr, ChequeError } from '@/lib/pdc/create'

export const dynamic = 'force-dynamic'

const include = {
  retailer: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  const mgr = canManageCheques(user.role)
  if (!mgr && !(user.role === 'SALESMAN' && user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const data = await prisma.cheque.findUnique({ where: { id }, include })
  if (!data || (!mgr && data.recordedById !== user.id)) return NextResponse.json({ error: 'Cheque not found' }, { status: 404 })
  return NextResponse.json({ data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getUserFromRequest(req)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const cheque = await prisma.cheque.findUnique({
    where: { id },
    include: { _count: { select: { payments: true, supplierPayments: true } } },
  })
  if (!cheque) return NextResponse.json({ error: 'Cheque not found' }, { status: 404 })
  const mode = user.id ? canEditCheque(user, cheque) : false
  if (!mode) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const partyTouched = 'retailerId' in body || 'supplierId' in body
  if (partyTouched && !canEditParty(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data: Prisma.ChequeUpdateManyMutationInput = {}
    if (mode === 'NOTES') {
      const extra = Object.keys(body).filter((k) => k !== 'notes')
      if (extra.length) throw new ChequeError(400, 'A cleared cheque only allows editing notes')
    }
    if ('notes' in body) data.notes = optStr(body.notes)
    if (mode === 'FULL') {
      if ('chequeNumber' in body) {
        const n = optStr(body.chequeNumber)
        if (!n) throw new ChequeError(400, 'Cheque number is required')
        data.chequeNumber = n
      }
      if ('amount' in body) {
        const a = parseChequeAmount(body.amount)
        // Defensive for Task 4 onward: once payments are linked to a cheque its amount must stay fixed.
        if (a !== Number(cheque.amount) && cheque._count.payments + cheque._count.supplierPayments > 0) {
          throw new ChequeError(409, 'Amount cannot change once payments are linked to this cheque')
        }
        data.amount = a
      }
      if ('chequeDate' in body) {
        const d = parseDateInput(body.chequeDate)
        if (!d) throw new ChequeError(400, 'Invalid cheque date')
        data.chequeDate = d
      }
      if ('receivedDate' in body) {
        const d = parseDateInput(body.receivedDate)
        if (!d) throw new ChequeError(400, 'Invalid received date')
        data.receivedDate = d
      }
      if ('drawerBank' in body) data.drawerBank = optStr(body.drawerBank)
      if ('pictureUrl' in body) data.pictureUrl = optStr(body.pictureUrl)
    }
    // bankAccountId is a scalar FK; updateMany takes it directly
    const extraData: { bankAccountId?: string | null; retailerId?: string | null; supplierId?: string | null } = {}
    if (mode === 'FULL' && partyTouched) {
      const p = await resolveParty(cheque.direction as 'RECEIVABLE' | 'PAYABLE', body.retailerId, body.supplierId)
      extraData.retailerId = p.retailerId
      extraData.supplierId = p.supplierId
    }
    if (mode === 'FULL' && 'bankAccountId' in body) {
      const b = optStr(body.bankAccountId)
      if (b) await assertBankAccount(b)
      extraData.bankAccountId = b
    }
    if (Object.keys(data).length + Object.keys(extraData).length === 0) {
      throw new ChequeError(400, 'Nothing to update')
    }

    const res = await prisma.cheque.updateMany({
      where: { id, status: cheque.status, acknowledgedAt: cheque.acknowledgedAt },
      data: { ...data, ...extraData },
    })
    if (res.count === 0) return NextResponse.json({ error: 'Cheque changed, reload and retry' }, { status: 409 })
    return NextResponse.json({ data: await prisma.cheque.findUnique({ where: { id }, include }) })
  } catch (e) {
    if (e instanceof ChequeError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
}
