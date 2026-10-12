/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA: deleting a stock batch writes its remaining stock off in the ledger (BATCH_WRITEOFF).
// PRODUCTION DB — QA-prefixed records only (QAW* medicines, 'QA Writeoff Manager'). Needs a dev server on :3100.
// Run: npx tsx tests/accounting/qa-writeoff.ts
// Refuses to run when any real Order/Invoice/JournalEntry/FixedAsset/PayrollRun exists. Settings are snapshotted and
// restored in `finally`.
import { createHmac } from 'crypto'
import { prisma, staffCookie, api, check } from '../portal/qa-helpers'
import { rebuildAll } from '../../lib/accounting/sync'

const ADMIN = staffCookie('ADMIN')
const QA_EMPLOYEE = 'QA Writeoff Manager'
const batchIds: string[] = []
const approvals: string[] = []

async function json(res: Response) { try { return await res.json() } catch { return null } }
const paisa = (n: any) => Math.round(Number(n) * 100)

function cookieFor(id: string, role: string) {
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret-2026'
  const payload = Buffer.from(JSON.stringify({ id, name: 'QA', role })).toString('base64url')
  return `sp_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const acctNet = async (systemKey: string) => {
  const a = await prisma.account.findFirst({ where: { systemKey } })
  const s = await prisma.journalLine.aggregate({ where: { accountId: a!.id }, _sum: { debit: true, credit: true } })
  return paisa(s._sum.debit ?? 0) - paisa(s._sum.credit ?? 0) // debit-positive
}
const writeoffs = (batchId: string) => prisma.journalEntry.findMany({ where: { sourceType: 'BATCH_WRITEOFF', sourceId: batchId }, include: { lines: { include: { account: true } } } })

async function main() {
  const counts = {
    order: await prisma.order.count(), invoice: await prisma.invoice.count(), journalEntry: await prisma.journalEntry.count(),
    fixedAsset: await prisma.fixedAsset.count(), payrollRun: await prisma.payrollRun.count(),
  }
  if (Object.values(counts).some((n) => n > 0)) throw new Error(`Refusing to run: real data exists ${JSON.stringify(counts)}`)
  if (await prisma.medicine.count({ where: { code: { startsWith: 'QAW' } } })) throw new Error('QA residue from a previous run exists')

  const s0 = await prisma.accountingSettings.findFirst()
  const orig = s0 ? { goLiveDate: s0.goLiveDate, lockedThrough: s0.lockedThrough, defaultBankAccountId: s0.defaultBankAccountId } : null
  try {
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
    const goLiveToday = new Date(`${today}T00:00:00+05:00`)
    await prisma.accountingSettings.updateMany({ data: { goLiveDate: goLiveToday, lockedThrough: null } })

    const mfr = await prisma.manufacturer.findFirst({ select: { id: true } })
    const code = `QAW${Math.floor(Math.random() * 900000 + 100000)}`
    const med = await prisma.medicine.create({ data: { code, name: `QA WRITEOFF ${code}`, manufacturerId: mfr!.id } })
    let n = 0
    const mkBatch = async (qty: number, price: number) => {
      const b = await prisma.medicineBatch.create({ data: { medicineId: med.id, batchNumber: `QAW-${++n}`, expiryDate: new Date('2030-01-01'), quantityIn: qty + 5, currentQty: qty, purchasePrice: price, tradePrice: price * 1.5 } })
      batchIds.push(b.id)
      return b
    }
    const del = (batchId: string, cookie = ADMIN) => api(`/api/inventory/${med.id}/batches?batchId=${batchId}`, cookie, { method: 'DELETE' })

    // ---- live: write-off posted with the delete ----
    const inv0 = await acctNet('INVENTORY')
    const oth0 = await acctNet('OTHER_EXPENSES')
    const A = await mkBatch(10, 25.55) // 255.50
    let res = await del(A.id)
    let j = await json(res)
    let es = await writeoffs(A.id)
    check('delete live batch: 200, writtenOff 255.50, batch gone', res.status === 200 && j?.writtenOff === 255.5 && !(await prisma.medicineBatch.findUnique({ where: { id: A.id } })), JSON.stringify(j))
    const e = es[0]
    check('one BATCH_WRITEOFF entry, auto (not manual), balanced, Dr Other Expenses / Cr Inventory 255.50',
      es.length === 1 && !e.isManual && e.lines.reduce((s, l) => s + paisa(l.debit), 0) === 25550 && e.lines.reduce((s, l) => s + paisa(l.credit), 0) === 25550 &&
      e.lines.some((l) => l.account.systemKey === 'OTHER_EXPENSES' && paisa(l.debit) === 25550) && e.lines.some((l) => l.account.systemKey === 'INVENTORY' && paisa(l.credit) === 25550))
    check('memo names medicine, batch and units', e?.memo === `Stock write-off: ${med.name} batch QAW-1 (10 units)`, e?.memo ?? '')
    check('entry dated today (Karachi)', !!e && new Date(e.date.getTime() + 5 * 3600_000).toISOString().slice(0, 10) === today)
    check('ledger movement: Inventory -255.50, Other Expenses +255.50', (await acctNet('INVENTORY')) - inv0 === -25550 && (await acctNet('OTHER_EXPENSES')) - oth0 === 25550)
    res = await api(`/api/accounts/journals/${e.id}/reverse`, staffCookie('ACCOUNTANT'), { method: 'POST', body: '{}' })
    check('write-off entry cannot be reversed by hand (auto entry) -> 400', res.status === 400)

    // ---- rebuild never touches it ----
    const sig = async () => JSON.stringify((await writeoffs(A.id)).map((x) => ({ id: x.id, n: x.entryNumber, l: x.lines.map((l) => [l.id, String(l.debit), String(l.credit)]) })))
    const before = await sig()
    const rep = await rebuildAll()
    check('rebuildAll leaves the write-off entry intact', before === (await sig()) && rep.errors.length === 0, `orphansRemoved ${rep.orphansRemoved}`)

    // ---- locked period refuses the delete ----
    const L = await mkBatch(4, 10)
    await prisma.accountingSettings.updateMany({ data: { lockedThrough: goLiveToday } })
    res = await del(L.id)
    j = await json(res)
    check('locked today: 409 with clear message, batch kept, nothing posted', res.status === 409 && j?.error === 'Cannot delete stock: accounting period is locked' && !!(await prisma.medicineBatch.findUnique({ where: { id: L.id } })) && (await writeoffs(L.id)).length === 0, JSON.stringify(j))

    // ---- MANAGER request: locked approval stays pending, unlocked approval posts ----
    const mgr = await prisma.employee.create({ data: { name: QA_EMPLOYEE, role: 'MANAGER', isActive: true } })
    const MGR = cookieFor(mgr.id, 'MANAGER')
    res = await del(L.id, MGR)
    j = await json(res)
    if (j?.approvalId) approvals.push(j.approvalId)
    check('MANAGER delete -> 202 pending', res.status === 202 && !!j?.approvalId)
    res = await api(`/api/approvals/${j.approvalId}`, ADMIN, { method: 'POST', body: JSON.stringify({ action: 'APPROVE' }) })
    check('approve while locked -> 409, approval still PENDING, batch kept', res.status === 409 && (await prisma.deleteApproval.findUnique({ where: { id: j.approvalId } }))!.status === 'PENDING' && !!(await prisma.medicineBatch.findUnique({ where: { id: L.id } })))
    await prisma.accountingSettings.updateMany({ data: { lockedThrough: null } })
    res = await api(`/api/approvals/${j.approvalId}`, ADMIN, { method: 'POST', body: JSON.stringify({ action: 'APPROVE' }) })
    es = await writeoffs(L.id)
    check('approve after unlock: 200, batch gone, write-off 40.00 posted', res.status === 200 && !(await prisma.medicineBatch.findUnique({ where: { id: L.id } })) && es.length === 1 && es[0].lines.reduce((s, l) => s + paisa(l.debit), 0) === 4000)

    // ---- zero-quantity batch posts nothing ----
    const Z = await mkBatch(0, 99)
    res = await del(Z.id)
    j = await json(res)
    check('zero-qty batch: 200, deleted, nothing posted', res.status === 200 && j?.writtenOff === 0 && !(await prisma.medicineBatch.findUnique({ where: { id: Z.id } })) && (await writeoffs(Z.id)).length === 0)

    // ---- not live: behaves as before ----
    const N1 = await mkBatch(3, 10)
    await prisma.accountingSettings.updateMany({ data: { goLiveDate: null } })
    res = await del(N1.id)
    check('no go-live: delete works, nothing posted', res.status === 200 && !(await prisma.medicineBatch.findUnique({ where: { id: N1.id } })) && (await writeoffs(N1.id)).length === 0)
    const N2 = await mkBatch(3, 10)
    await prisma.accountingSettings.updateMany({ data: { goLiveDate: new Date(goLiveToday.getTime() + 2 * 86400_000) } })
    res = await del(N2.id)
    check('go-live in the future: delete works, nothing posted', res.status === 200 && !(await prisma.medicineBatch.findUnique({ where: { id: N2.id } })) && (await writeoffs(N2.id)).length === 0)

    const tb = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
    check('trial balance: debits == credits', paisa(tb._sum.debit) === paisa(tb._sum.credit))
  } finally {
    await cleanup(orig)
  }
}

async function cleanup(orig: { goLiveDate: Date | null; lockedThrough: Date | null; defaultBankAccountId: string | null } | null) {
  await prisma.accountingSettings.updateMany({ data: { goLiveDate: orig?.goLiveDate ?? null, lockedThrough: orig?.lockedThrough ?? null, defaultBankAccountId: orig?.defaultBankAccountId ?? null } })
  await prisma.journalEntry.deleteMany({ where: { sourceType: 'BATCH_WRITEOFF', sourceId: { in: batchIds } } })
  const emp = (await prisma.employee.findMany({ where: { name: QA_EMPLOYEE }, select: { id: true } })).map((e) => e.id)
  const aps = Array.from(new Set([...approvals, ...(await prisma.deleteApproval.findMany({ where: { requestedById: { in: emp } }, select: { id: true } })).map((a) => a.id)]))
  await prisma.notification.deleteMany({ where: { OR: [{ referenceId: { in: aps } }, { employeeId: { in: emp } }] } })
  await prisma.deleteApproval.deleteMany({ where: { id: { in: aps } } })
  await prisma.employee.deleteMany({ where: { id: { in: emp } } })
  await prisma.medicineBatch.deleteMany({ where: { medicine: { code: { startsWith: 'QAW' } } } })
  await prisma.medicine.deleteMany({ where: { code: { startsWith: 'QAW' } } })
  const left = (await prisma.medicine.count({ where: { code: { startsWith: 'QAW' } } })) + (await prisma.employee.count({ where: { name: QA_EMPLOYEE } }))
  check('cleanup: no QA residue', left === 0)
  check('cleanup: journal entries back to 0', (await prisma.journalEntry.count()) === 0)
  const s = await prisma.accountingSettings.findFirst()
  check('cleanup: settings identical to snapshot',
    (s?.goLiveDate?.getTime() ?? null) === (orig?.goLiveDate?.getTime() ?? null) && (s?.lockedThrough?.getTime() ?? null) === (orig?.lockedThrough?.getTime() ?? null) && (s?.defaultBankAccountId ?? null) === (orig?.defaultBankAccountId ?? null))
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
