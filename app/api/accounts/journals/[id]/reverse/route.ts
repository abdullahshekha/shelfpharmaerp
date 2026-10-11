import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { AccountingError, assertManualPostable, getSettings, postEntry } from '@/lib/accounting/core'
import { parseDateInput } from '@/lib/accounting/dates'

export const dynamic = 'force-dynamic'

const HttpError = AccountingError

// Reverses a MANUAL entry with a mirrored entry. Auto entries follow their source and cannot be reversed.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const date = body?.date ? parseDateInput(body.date) : new Date()
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  try {
    const entry = await prisma.$transaction(
      async (tx) => {
        // Serialise reversals of the same entry so two concurrent requests cannot both succeed.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'REVERSE:' + id}))`
        const orig = await tx.journalEntry.findUnique({ where: { id }, include: { lines: true } })
        if (!orig) throw new HttpError(404, 'Entry not found')
        if (!orig.isManual) throw new HttpError(400, 'Automatic entries follow their source record and cannot be reversed by hand')
        if (orig.reversesId) throw new HttpError(400, 'A reversal entry cannot itself be reversed')
        const already = await tx.journalEntry.findFirst({ where: { reversesId: id }, select: { entryNumber: true } })
        if (already) throw new HttpError(409, `Entry was already reversed by ${already.entryNumber}`)
        assertManualPostable(await getSettings(tx), date)
        return postEntry(tx, {
          date,
          memo: `Reversal of ${orig.entryNumber}${orig.memo ? ` — ${orig.memo}` : ''}`,
          isManual: true,
          createdById: auth.user.id,
          reversesId: orig.id,
          lines: orig.lines.map((l) => ({
            accountId: l.accountId,
            debit: Number(l.credit),
            credit: Number(l.debit),
            memo: l.memo ?? undefined,
            retailerId: l.retailerId ?? undefined,
            supplierId: l.supplierId ?? undefined,
            employeeId: l.employeeId ?? undefined,
          })),
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
