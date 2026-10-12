/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA: restock when a DELIVERED order is cancelled / hard-deleted / un-delivered.
// PRODUCTION DB — QA-prefixed records only ('QA Restock ...' retailer/employee, QAR* medicines). Needs a dev server
// on :3100. Run: npx tsx tests/accounting/qa-restock.ts
// Refuses to run when any real Order/Invoice/JournalEntry/FixedAsset/PayrollRun exists. Settings are snapshotted and
// restored in `finally` (go-live is set to today for the run so the COGS hook posts).
import { createHmac } from 'crypto'
import { prisma, staffCookie, api, check } from '../portal/qa-helpers'

const ADMIN = staffCookie('ADMIN')
const QA_CUSTOMER = 'QA Restock Customer'
const QA_EMPLOYEE = 'QA Restock Manager'

const created = { orders: [] as string[], invoices: [] as string[], payments: [] as string[], approvals: [] as string[], medicines: [] as string[] }

async function json(res: Response) { try { return await res.json() } catch { return null } }
const paisa = (n: any) => Math.round(Number(n) * 100)

function cookieFor(id: string, role: string) {
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret-2026'
  const payload = Buffer.from(JSON.stringify({ id, name: 'QA', role })).toString('base64url')
  return `sp_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

const stock = async (medicineId: string) => (await prisma.medicineBatch.aggregate({ where: { medicineId }, _sum: { currentQty: true } }))._sum.currentQty ?? 0
const batchQty = async (id: string) => (await prisma.medicineBatch.findUnique({ where: { id } }))!.currentQty
const cogs = async (orderId: string) => {
  const es = await prisma.journalEntry.findMany({ where: { sourceType: 'DELIVERY_COGS', sourceId: orderId }, include: { lines: true } })
  return { count: es.length, amount: es.reduce((s, e) => s + e.lines.reduce((x, l) => x + paisa(l.debit), 0), 0) }
}
const setStatus = (id: string, status: string, cookie = ADMIN) => api(`/api/orders/${id}/status`, cookie, { method: 'PUT', body: JSON.stringify({ status }) })

async function main() {
  // ---- live-state precheck ----
  const counts = {
    order: await prisma.order.count(), invoice: await prisma.invoice.count(), journalEntry: await prisma.journalEntry.count(),
    fixedAsset: await prisma.fixedAsset.count(), payrollRun: await prisma.payrollRun.count(),
  }
  if (Object.values(counts).some((n) => n > 0)) throw new Error(`Refusing to run: real data exists ${JSON.stringify(counts)}`)
  if (await prisma.retailer.count({ where: { name: QA_CUSTOMER } })) throw new Error('QA residue from a previous run exists')

  const s0 = await prisma.accountingSettings.findFirst()
  const orig = s0 ? { goLiveDate: s0.goLiveDate, lockedThrough: s0.lockedThrough, defaultBankAccountId: s0.defaultBankAccountId } : null
  try {
    const k = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
    await prisma.accountingSettings.updateMany({ data: { goLiveDate: new Date(`${k}T00:00:00+05:00`), lockedThrough: null } })

    const mfr = await prisma.manufacturer.findFirst({ select: { id: true } })
    const retailer = await prisma.retailer.create({ data: { name: QA_CUSTOMER } })
    const mkMed = async (tag: string) => {
      const code = `QAR${Math.floor(Math.random() * 900000 + 100000)}`
      const m = await prisma.medicine.create({ data: { code, name: `QA RESTOCK ${tag} ${code}`, manufacturerId: mfr!.id } })
      created.medicines.push(m.id)
      return m
    }
    const med = await mkMed('A')
    const B1 = await prisma.medicineBatch.create({ data: { medicineId: med.id, batchNumber: 'QAR-B1', expiryDate: new Date('2030-01-01'), quantityIn: 20, currentQty: 20, purchasePrice: 50, tradePrice: 100 } })
    const B2 = await prisma.medicineBatch.create({ data: { medicineId: med.id, batchNumber: 'QAR-B2', expiryDate: new Date('2031-01-01'), quantityIn: 100, currentQty: 100, purchasePrice: 60, tradePrice: 100 } })

    const mkOrder = async (medicineId: string, qty: number) => {
      const res = await api('/api/orders', ADMIN, { method: 'POST', body: JSON.stringify({ retailerId: retailer.id, items: [{ medicineId, quantity: qty, unitPrice: 100, offerPercent: 0, salesTax: 0 }] }) })
      const o = (await json(res)).data
      created.orders.push(o.id)
      return o.id as string
    }
    const confirmAndDeliver = async (id: string) => {
      await setStatus(id, 'CONFIRMED')
      const inv = await prisma.invoice.findUnique({ where: { orderId: id }, select: { id: true } })
      if (inv) created.invoices.push(inv.id)
      return setStatus(id, 'DELIVERED')
    }

    // ---- 1. deliver: stock down, COGS posted ----
    const O1 = await mkOrder(med.id, 30)
    let res = await confirmAndDeliver(O1)
    check('deliver O1 (30): 200; stock 120 -> 90 (B1 20->0, B2 100->90)', res.status === 200 && (await stock(med.id)) === 90 && (await batchQty(B1.id)) === 0 && (await batchQty(B2.id)) === 90)
    let item = await prisma.orderItem.findFirst({ where: { orderId: O1 } })
    check('deductedQty = 30, unitCost set', item!.deductedQty === 30 && Number(item!.unitCost) > 0)
    let c = await cogs(O1)
    check('COGS entry posted: 20x50 + 10x60 = 1600', c.count === 1 && c.amount === 160000, JSON.stringify(c))

    // ---- 2. soft cancel restocks, COGS gone ----
    res = await api(`/api/orders/${O1}`, ADMIN, { method: 'DELETE' })
    let j = await json(res)
    check('soft cancel delivered O1: 200, stock back to 120 (restocked onto earliest batch B1)', res.status === 200 && j?.success === true && Array.isArray(j?.warnings) && (await stock(med.id)) === 120 && (await batchQty(B1.id)) === 30)
    item = await prisma.orderItem.findFirst({ where: { orderId: O1 } })
    check('after cancel: status CANCELLED, unitCost/deductedQty null', (await prisma.order.findUnique({ where: { id: O1 } }))!.status === 'CANCELLED' && item!.unitCost === null && item!.deductedQty === null)
    check('after cancel: COGS entry gone', (await cogs(O1)).count === 0)
    res = await api(`/api/orders/${O1}`, ADMIN, { method: 'DELETE' })
    check('cancel again (already CANCELLED): stock unchanged', res.status === 200 && (await stock(med.id)) === 120)

    // ---- 3. deliver again: stock down, COGS back ----
    res = await setStatus(O1, 'DELIVERED')
    c = await cogs(O1)
    check('re-deliver O1: stock 90 again, COGS back (30 x 50 from B1)', res.status === 200 && (await stock(med.id)) === 90 && c.count === 1 && c.amount === 150000, JSON.stringify(c))

    // ---- 4. concurrent double cancel restocks once ----
    const [d1, d2] = await Promise.all([api(`/api/orders/${O1}`, ADMIN, { method: 'DELETE' }), api(`/api/orders/${O1}`, ADMIN, { method: 'DELETE' })])
    check('concurrent double cancel: both 200, stock restored exactly once (120)', d1.status === 200 && d2.status === 200 && (await stock(med.id)) === 120, `${d1.status},${d2.status} stock ${await stock(med.id)}`)
    check('concurrent cancel: COGS gone', (await cogs(O1)).count === 0)

    // ---- 5. hard delete of a CANCELLED (already restocked) order: no restock ----
    res = await api(`/api/orders/${O1}?hard=true`, ADMIN, { method: 'DELETE' })
    check('hard delete of cancelled O1: 200, stock unchanged (120), order gone', res.status === 200 && (await stock(med.id)) === 120 && !(await prisma.order.findUnique({ where: { id: O1 } })))

    // ---- 6. hard delete while DELIVERED restocks ----
    const O2 = await mkOrder(med.id, 5)
    await confirmAndDeliver(O2)
    check('deliver O2 (5): stock 115', (await stock(med.id)) === 115 && (await cogs(O2)).count === 1)
    const inv2 = await prisma.invoice.findUnique({ where: { orderId: O2 }, select: { id: true } })
    res = await api(`/api/orders/${O2}?hard=true`, ADMIN, { method: 'DELETE' })
    check('hard delete of delivered O2: 200, stock back to 120, COGS + invoice entries gone', res.status === 200 && (await stock(med.id)) === 120 && (await cogs(O2)).count === 0 &&
      (await prisma.journalEntry.count({ where: { sourceType: 'INVOICE', sourceId: inv2?.id ?? '-' } })) === 0)

    // ---- 7. never-delivered hard delete: stock unchanged ----
    const O3 = await mkOrder(med.id, 7)
    await setStatus(O3, 'CONFIRMED')
    const inv3 = await prisma.invoice.findUnique({ where: { orderId: O3 }, select: { id: true } })
    if (inv3) created.invoices.push(inv3.id)
    res = await api(`/api/orders/${O3}?hard=true`, ADMIN, { method: 'DELETE' })
    check('hard delete of never-delivered O3: stock unchanged (120)', res.status === 200 && (await stock(med.id)) === 120)

    // ---- 8. un-deliver via status PUT ----
    const O4 = await mkOrder(med.id, 4)
    await confirmAndDeliver(O4)
    const dlv = await prisma.delivery.findUnique({ where: { orderId: O4 } })
    check('deliver O4: stock 116, delivery DELIVERED with deliveredAt', (await stock(med.id)) === 116 && dlv?.status === 'DELIVERED' && !!dlv?.deliveredAt)
    res = await setStatus(O4, 'DISPATCHED')
    const dlv2 = await prisma.delivery.findUnique({ where: { orderId: O4 } })
    item = await prisma.orderItem.findFirst({ where: { orderId: O4 } })
    check('status DELIVERED -> DISPATCHED: stock back (120), delivery SCHEDULED, deliveredAt null, COGS gone, cost cleared',
      res.status === 200 && (await stock(med.id)) === 120 && dlv2?.status === 'SCHEDULED' && dlv2?.deliveredAt === null && (await cogs(O4)).count === 0 && item!.unitCost === null && item!.deductedQty === null)
    res = await setStatus(O4, 'DISPATCHED')
    check('DISPATCHED again: no further restock', res.status === 200 && (await stock(med.id)) === 120)
    res = await setStatus(O4, 'DELIVERED')
    check('re-deliver O4 after un-deliver: stock 116, COGS back', res.status === 200 && (await stock(med.id)) === 116 && (await cogs(O4)).count === 1)
    const [s1, s2] = await Promise.all([setStatus(O4, 'PICKING'), setStatus(O4, 'PICKING')])
    check('concurrent un-deliver: restocked once (120)', s1.status === 200 && s2.status === 200 && (await stock(med.id)) === 120, `stock ${await stock(med.id)}`)
    res = await setStatus(O4, 'DELIVERED')
    res = await setStatus(O4, 'CANCELLED')
    const dlv3 = await prisma.delivery.findUnique({ where: { orderId: O4 } })
    check('status PUT DELIVERED -> CANCELLED: restocked (120), delivery row left as is', res.status === 200 && (await stock(med.id)) === 120 && dlv3?.status === 'DELIVERED')

    // ---- 9. shortfall delivery restocks only what was deducted ----
    const medS = await mkMed('S')
    const BS = await prisma.medicineBatch.create({ data: { medicineId: medS.id, batchNumber: 'QAR-S1', expiryDate: new Date('2030-01-01'), quantityIn: 3, currentQty: 3, purchasePrice: 40, tradePrice: 80 } })
    const O5 = await mkOrder(medS.id, 5)
    await confirmAndDeliver(O5)
    item = await prisma.orderItem.findFirst({ where: { orderId: O5 } })
    check('shortfall delivery (5 ordered, 3 in stock): deductedQty 3, stock 0', item!.deductedQty === 3 && (await batchQty(BS.id)) === 0)
    res = await api(`/api/orders/${O5}`, ADMIN, { method: 'DELETE' })
    check('cancel shortfall order: restocks 3 (not 5)', res.status === 200 && (await batchQty(BS.id)) === 3)

    // ---- 10. admin edit of a delivered order keeps deductedQty consistent ----
    const O6 = await mkOrder(med.id, 10)
    await confirmAndDeliver(O6) // 120 -> 110
    const it6 = (await prisma.orderItem.findFirst({ where: { orderId: O6 } }))!
    res = await api(`/api/orders/${O6}`, ADMIN, { method: 'PUT', body: JSON.stringify({ items: [{ id: it6.id, quantity: 13, unitPrice: 100 }] }) })
    check('admin edit +3: stock 107, deductedQty 13', res.status === 200 && (await stock(med.id)) === 107 && (await prisma.orderItem.findUnique({ where: { id: it6.id } }))!.deductedQty === 13)
    res = await api(`/api/orders/${O6}`, ADMIN, { method: 'PUT', body: JSON.stringify({ items: [{ id: it6.id, quantity: 8, unitPrice: 100 }] }) })
    check('admin edit -5: stock 112, deductedQty 8', res.status === 200 && (await stock(med.id)) === 112 && (await prisma.orderItem.findUnique({ where: { id: it6.id } }))!.deductedQty === 8)
    res = await api(`/api/orders/${O6}`, ADMIN, { method: 'DELETE' })
    check('cancel after edits: restocks 8 (stock 120)', res.status === 200 && (await stock(med.id)) === 120)

    // ---- 11. MANAGER request -> ADMIN approval goes through the same restock path ----
    const mgr = await prisma.employee.create({ data: { name: QA_EMPLOYEE, role: 'MANAGER', isActive: true } })
    const MGR = cookieFor(mgr.id, 'MANAGER')
    const O7 = await mkOrder(med.id, 6)
    await confirmAndDeliver(O7) // 114
    res = await api(`/api/orders/${O7}?hard=true`, MGR, { method: 'DELETE' })
    j = await json(res)
    if (j?.approvalId) created.approvals.push(j.approvalId)
    check('MANAGER hard delete of delivered O7 -> 202 pending, stock still 114', res.status === 202 && (await stock(med.id)) === 114)
    res = await api(`/api/approvals/${j.approvalId}`, ADMIN, { method: 'POST', body: JSON.stringify({ action: 'APPROVE' }) })
    check('ADMIN approves: order gone, stock back to 120, COGS gone', res.status === 200 && !(await prisma.order.findUnique({ where: { id: O7 } })) && (await stock(med.id)) === 120 && (await cogs(O7)).count === 0)
    res = await api(`/api/approvals/${j.approvalId}`, ADMIN, { method: 'POST', body: JSON.stringify({ action: 'APPROVE' }) })
    check('approving twice -> 404, no double restock', res.status === 404 && (await stock(med.id)) === 120)

    // ---- ledger integrity ----
    const tb = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
    check('trial balance: debits == credits', paisa(tb._sum.debit) === paisa(tb._sum.credit))
  } finally {
    await cleanup(orig)
  }
}

async function cleanup(orig: { goLiveDate: Date | null; lockedThrough: Date | null; defaultBankAccountId: string | null } | null) {
  await prisma.accountingSettings.updateMany({ data: { goLiveDate: orig?.goLiveDate ?? null, lockedThrough: orig?.lockedThrough ?? null, defaultBankAccountId: orig?.defaultBankAccountId ?? null } })
  const rid = (await prisma.retailer.findMany({ where: { name: QA_CUSTOMER }, select: { id: true } })).map((r) => r.id)
  const orders = Array.from(new Set([...created.orders, ...(await prisma.order.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)]))
  const invs = Array.from(new Set([...created.invoices, ...(await prisma.invoice.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)]))
  const pays = (await prisma.payment.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((p) => p.id)
  await prisma.journalEntry.deleteMany({ where: { sourceId: { in: [...orders, ...invs, ...pays] } } })
  await prisma.payment.deleteMany({ where: { id: { in: pays } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs } } })
  await prisma.deliveryChallan.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.delivery.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.order.deleteMany({ where: { id: { in: orders } } })
  const emp = (await prisma.employee.findMany({ where: { name: QA_EMPLOYEE }, select: { id: true } })).map((e) => e.id)
  const approvals = Array.from(new Set([...created.approvals, ...(await prisma.deleteApproval.findMany({ where: { requestedById: { in: emp } }, select: { id: true } })).map((a) => a.id)]))
  await prisma.notification.deleteMany({ where: { OR: [{ referenceId: { in: approvals } }, { employeeId: { in: emp } }] } })
  await prisma.deleteApproval.deleteMany({ where: { id: { in: approvals } } })
  await prisma.employee.deleteMany({ where: { id: { in: emp } } })
  await prisma.medicineBatch.deleteMany({ where: { medicine: { code: { startsWith: 'QAR' } } } })
  await prisma.medicine.deleteMany({ where: { code: { startsWith: 'QAR' } } })
  await prisma.retailer.deleteMany({ where: { id: { in: rid } } })

  const left = (await prisma.retailer.count({ where: { name: QA_CUSTOMER } })) + (await prisma.medicine.count({ where: { code: { startsWith: 'QAR' } } })) +
    (await prisma.employee.count({ where: { name: QA_EMPLOYEE } })) + (await prisma.order.count()) + (await prisma.invoice.count())
  check('cleanup: no QA residue (and no orders/invoices left)', left === 0, `(${left})`)
  check('cleanup: journal entries back to 0', (await prisma.journalEntry.count()) === 0)
  const s = await prisma.accountingSettings.findFirst()
  check('cleanup: settings identical to snapshot',
    (s?.goLiveDate?.getTime() ?? null) === (orig?.goLiveDate?.getTime() ?? null) && (s?.lockedThrough?.getTime() ?? null) === (orig?.lockedThrough?.getTime() ?? null) && (s?.defaultBankAccountId ?? null) === (orig?.defaultBankAccountId ?? null))
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
