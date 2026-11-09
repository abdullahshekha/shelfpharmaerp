/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA: stock and COGS when an order whose stock has left (OUT_FOR_DELIVERY / ON_HOLD / DELIVERED) is
// cancelled, hard-deleted or un-assigned (Phase 18 flow: stock leaves FEFO at ASSIGNMENT, the DELIVERY_COGS entry is
// dated Delivery.assignedAt, a cancel/un-assign restocks what is still deducted, once).
// PRODUCTION DB — QA-prefixed records only ('QA Restock ...' retailer/employees, QAR* medicines). Needs a dev server
// on :3100 started WITHOUT DELIVERY_TEST_SKIP_SYNC (the COGS hooks must post; the script refuses otherwise).
// Run: npx tsx tests/accounting/qa-restock.ts
// Refuses to run when any real Order/Invoice/JournalEntry/FixedAsset/PayrollRun exists. Settings are snapshotted and
// restored in `finally` (go-live is set to today for the run so the COGS hook posts).
// Rewritten 2026-11-10 for the new order/delivery flow; NOT YET RUN against it.
import { createHmac } from 'crypto'
import { prisma, staffCookie, api, check } from '../portal/qa-helpers'
import {
  assignOrder, unassignOrder, payLater, holdOrder, recordOutcomeApi, createQaAssignee, requireLedgerSyncOn,
  qaDeliveryPictureUrl, karachiToday, karachiTomorrow, mustAssign, mustAssignAndPayLater,
} from '../deliveries/qa-flow-helpers'

const ADMIN = staffCookie('ADMIN')
const QA_CUSTOMER = 'QA Restock Customer'
const QA_EMPLOYEE = 'QA Restock Manager'
const QA_DRIVER = 'QA Restock Driver'

const COGS_LOCKED = 'Cannot cancel or un-deliver: the delivery cost was posted in a locked accounting period'
const RETURN_BLOCK = 'Order has a return; cannot cancel/delete'
const COLLECTION_CANCEL = 'Order has a delivery collection; cannot cancel.'
const COLLECTION_DELETE = 'Order has a delivery collection; acknowledge or resolve it first'
const EDIT_OUTCOME = 'This delivery already has a recorded outcome; the order cannot be edited (use a Sales Return)'

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
  return { count: es.length, amount: es.reduce((s, e) => s + e.lines.reduce((x, l) => x + paisa(l.debit), 0), 0), date: es[0]?.date?.getTime() ?? null }
}
const orderRow = (id: string) => prisma.order.findUnique({ where: { id }, include: { items: true, delivery: true } })
const item1 = async (orderId: string) => (await prisma.orderItem.findFirst({ where: { orderId } }))!
const setStatus = (id: string, status: string, cookie = ADMIN) => api(`/api/orders/${id}/status`, cookie, { method: 'PUT', body: JSON.stringify({ status }) })
const editQty = (orderId: string, itemId: string, quantity: number) =>
  api(`/api/orders/${orderId}`, ADMIN, { method: 'PUT', body: JSON.stringify({ items: [{ id: itemId, quantity, unitPrice: 100 }] }) })

async function main() {
  // ---- live-state precheck ----
  const counts = {
    order: await prisma.order.count(), invoice: await prisma.invoice.count(), journalEntry: await prisma.journalEntry.count(),
    fixedAsset: await prisma.fixedAsset.count(), payrollRun: await prisma.payrollRun.count(),
  }
  if (Object.values(counts).some((n) => n > 0)) throw new Error(`Refusing to run: real data exists ${JSON.stringify(counts)}`)
  if (await prisma.retailer.count({ where: { name: QA_CUSTOMER } })) throw new Error('QA residue from a previous run exists')
  await requireLedgerSyncOn(ADMIN)

  const s0 = await prisma.accountingSettings.findFirst()
  const orig = s0 ? { goLiveDate: s0.goLiveDate, lockedThrough: s0.lockedThrough, defaultBankAccountId: s0.defaultBankAccountId } : null
  try {
    const k = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
    await prisma.accountingSettings.updateMany({ data: { goLiveDate: new Date(`${k}T00:00:00+05:00`), lockedThrough: null } })

    const mfr = await prisma.manufacturer.findFirst({ select: { id: true } })
    const retailer = await prisma.retailer.create({ data: { name: QA_CUSTOMER } })
    const drv = await createQaAssignee(QA_DRIVER, 'DRIVER')
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
    const confirm = async (id: string) => {
      const res = await setStatus(id, 'INVOICED')
      const inv = await prisma.invoice.findUnique({ where: { orderId: id }, select: { id: true } })
      if (inv) created.invoices.push(inv.id)
      return res
    }
    /** RECEIVED -> INVOICED -> OUT_FOR_DELIVERY (stock out, COGS posted). */
    const confirmAndAssign = async (id: string) => { await confirm(id); return mustAssign(id, drv.id, ADMIN) }
    /** RECEIVED -> INVOICED -> OUT_FOR_DELIVERY -> DELIVERED (Pay Later). The old confirmAndDeliver. */
    const confirmAndDeliver = async (id: string) => { await confirm(id); return mustAssignAndPayLater(id, drv.id, ADMIN) }

    // ---- 0. the generic status route no longer moves an order out for delivery / delivered ----
    {
      const O0 = await mkOrder(med.id, 1)
      await confirm(O0)
      const codes = await Promise.all(['OUT_FOR_DELIVERY', 'DELIVERED', 'DISPATCHED', 'PICKING', 'ON_HOLD', 'RETURNED'].map(async (s) => (await setStatus(O0, s)).status))
      check('status route: OUT_FOR_DELIVERY/DELIVERED/DISPATCHED/PICKING/ON_HOLD/RETURNED -> 400, order still INVOICED, stock 120',
        codes.every((c) => c === 400) && (await orderRow(O0))?.status === 'INVOICED' && (await stock(med.id)) === 120, codes.join(','))
      const twice = await setStatus(O0, 'INVOICED')
      check('confirming an INVOICED order again -> 409', twice.status === 409, String(twice.status))
      const res = await api(`/api/orders/${O0}?hard=true`, ADMIN, { method: 'DELETE' })
      check('hard delete of the never-assigned O0: 200, stock unchanged', res.status === 200 && (await stock(med.id)) === 120)
    }

    // ---- 1. assign: stock down at assignment, COGS posted dated assignedAt; Pay Later changes neither ----
    const O1 = await mkOrder(med.id, 30)
    await confirm(O1)
    check('confirm O1: stock unchanged (120), no COGS', (await stock(med.id)) === 120 && (await cogs(O1)).count === 0)
    let res: Response
    let r = await assignOrder(O1, drv.id, ADMIN)
    let row = await orderRow(O1)
    check('assign O1 (30): 200, OUT_FOR_DELIVERY; stock 120 -> 90 (B1 20->0, B2 100->90)',
      r.status === 200 && row?.status === 'OUT_FOR_DELIVERY' && (await stock(med.id)) === 90 && (await batchQty(B1.id)) === 0 && (await batchQty(B2.id)) === 90, `${r.status} ${JSON.stringify(r.json)}`)
    let item = await item1(O1)
    check('deductedQty = 30, unitCost set ((20x50 + 10x60)/30)', item.deductedQty === 30 && Math.abs(Number(item.unitCost) - 1600 / 30) < 0.001, String(item.unitCost))
    let c = await cogs(O1)
    check('COGS entry posted at assignment: 20x50 + 10x60 = 1600, dated Delivery.assignedAt',
      c.count === 1 && c.amount === 160000 && !!row?.delivery?.assignedAt && c.date === row.delivery.assignedAt.getTime(), JSON.stringify(c))
    r = await payLater(O1, ADMIN)
    row = await orderRow(O1)
    const c1b = await cogs(O1)
    check('Pay Later O1: DELIVERED, deliveredAt set, stock still 90, COGS unchanged (still dated assignedAt)',
      r.status === 200 && row?.status === 'DELIVERED' && !!row.delivery?.deliveredAt && (await stock(med.id)) === 90 && JSON.stringify(c1b) === JSON.stringify(c), `${r.status} ${JSON.stringify(c1b)}`)

    // ---- 2. soft cancel of a DELIVERED order restocks, COGS gone ----
    res = await api(`/api/orders/${O1}`, ADMIN, { method: 'DELETE' })
    let j = await json(res)
    check('soft cancel delivered O1: 200, stock back to 120 (restocked onto earliest batch B1)', res.status === 200 && j?.success === true && Array.isArray(j?.warnings) && (await stock(med.id)) === 120 && (await batchQty(B1.id)) === 30)
    item = await item1(O1)
    check('after cancel: status CANCELLED, unitCost/deductedQty null', (await orderRow(O1))!.status === 'CANCELLED' && item.unitCost === null && item.deductedQty === null)
    check('after cancel: COGS entry gone', (await cogs(O1)).count === 0)
    res = await api(`/api/orders/${O1}`, ADMIN, { method: 'DELETE' })
    check('cancel again (already CANCELLED): stock unchanged', res.status === 200 && (await stock(med.id)) === 120)

    // ---- 3. CANCELLED is final: no re-assign, no re-confirm ----
    r = await assignOrder(O1, drv.id, ADMIN)
    const reconf = await setStatus(O1, 'INVOICED')
    check('assign of a CANCELLED order -> 409, re-confirm -> 409; stock 120, no COGS',
      r.status === 409 && reconf.status === 409 && (await stock(med.id)) === 120 && (await cogs(O1)).count === 0, `${r.status} ${reconf.status}`)

    // ---- 4. concurrent double cancel of an OUT_FOR_DELIVERY order restocks once ----
    const O1b = await mkOrder(med.id, 30)
    await confirmAndAssign(O1b)
    c = await cogs(O1b)
    check('assign O1b (30): stock 90, COGS 30 x 50 from B1 (restocked there) = 1500', (await stock(med.id)) === 90 && c.count === 1 && c.amount === 150000, JSON.stringify(c))
    const [d1, d2] = await Promise.all([api(`/api/orders/${O1b}`, ADMIN, { method: 'DELETE' }), api(`/api/orders/${O1b}`, ADMIN, { method: 'DELETE' })])
    check('concurrent double cancel (OUT_FOR_DELIVERY): both 200, stock restored exactly once (120)', d1.status === 200 && d2.status === 200 && (await stock(med.id)) === 120, `${d1.status},${d2.status} stock ${await stock(med.id)}`)
    check('concurrent cancel: COGS gone', (await cogs(O1b)).count === 0)

    // ---- 5. hard delete of a CANCELLED (already restocked) order: no restock ----
    res = await api(`/api/orders/${O1}?hard=true`, ADMIN, { method: 'DELETE' })
    check('hard delete of cancelled O1: 200, stock unchanged (120), order gone', res.status === 200 && (await stock(med.id)) === 120 && !(await prisma.order.findUnique({ where: { id: O1 } })))

    // ---- 6. hard delete while DELIVERED restocks (admin edit refused once an outcome exists) ----
    const O2 = await mkOrder(med.id, 5)
    await confirmAndDeliver(O2)
    check('deliver O2 (5): stock 115, COGS posted', (await stock(med.id)) === 115 && (await cogs(O2)).count === 1)
    const it2 = await item1(O2)
    res = await editQty(O2, it2.id, 6)
    check('admin edit of a DELIVERED (Pay Later) order -> 409 (outcome recorded), stock unchanged', res.status === 409 && (await json(res))?.error === EDIT_OUTCOME && (await stock(med.id)) === 115)
    const inv2 = await prisma.invoice.findUnique({ where: { orderId: O2 }, select: { id: true } })
    res = await api(`/api/orders/${O2}?hard=true`, ADMIN, { method: 'DELETE' })
    check('hard delete of delivered O2: 200, stock back to 120, COGS + invoice entries gone', res.status === 200 && (await stock(med.id)) === 120 && (await cogs(O2)).count === 0 &&
      (await prisma.journalEntry.count({ where: { sourceType: 'INVOICE', sourceId: inv2?.id ?? '-' } })) === 0)

    // ---- 7. never-assigned hard delete: stock unchanged ----
    const O3 = await mkOrder(med.id, 7)
    await confirm(O3)
    res = await api(`/api/orders/${O3}?hard=true`, ADMIN, { method: 'DELETE' })
    check('hard delete of never-assigned (INVOICED) O3: stock unchanged (120)', res.status === 200 && (await stock(med.id)) === 120)

    // ---- 8. un-assign (replaces the old "un-deliver via status PUT"), On Hold keeps stock out, cancel of ON_HOLD ----
    const O4 = await mkOrder(med.id, 4)
    await confirmAndAssign(O4)
    let dlv = (await orderRow(O4))!.delivery
    const assignedAt1 = dlv?.assignedAt?.getTime() ?? null
    check('assign O4: stock 116, delivery OUT_FOR_DELIVERY with driver + assignedAt, COGS dated assignedAt',
      (await stock(med.id)) === 116 && dlv?.status === 'OUT_FOR_DELIVERY' && dlv?.driverId === drv.id && assignedAt1 !== null && (await cogs(O4)).date === assignedAt1)
    r = await unassignOrder(O4, ADMIN)
    row = await orderRow(O4)
    item = await item1(O4)
    check('un-assign O4: 200, order INVOICED, stock back (120), delivery SCHEDULED, driver/assignedAt null, COGS gone, cost cleared',
      r.status === 200 && row?.status === 'INVOICED' && (await stock(med.id)) === 120 && row.delivery?.status === 'SCHEDULED' && row.delivery?.driverId === null && row.delivery?.assignedAt === null &&
      (await cogs(O4)).count === 0 && item.unitCost === null && item.deductedQty === null, `${r.status} ${JSON.stringify(r.json)}`)
    r = await unassignOrder(O4, ADMIN)
    check('un-assign again (INVOICED) -> 409, no further restock', r.status === 409 && (await stock(med.id)) === 120)
    await new Promise((x) => setTimeout(x, 20))
    await mustAssign(O4, drv.id, ADMIN)
    dlv = (await orderRow(O4))!.delivery
    check('re-assign O4: stock 116, COGS back dated the NEW assignedAt', (await stock(med.id)) === 116 && (await cogs(O4)).count === 1 && (await cogs(O4)).date === dlv?.assignedAt?.getTime() && dlv?.assignedAt?.getTime() !== assignedAt1)
    const [u1, u2] = await Promise.all([unassignOrder(O4, ADMIN), unassignOrder(O4, ADMIN)])
    check('concurrent un-assign: one 200 and one 409, restocked once (120)', [u1.status, u2.status].sort().join(',') === '200,409' && (await stock(med.id)) === 120, `${u1.status},${u2.status} stock ${await stock(med.id)}`)
    await mustAssign(O4, drv.id, ADMIN)
    const assignedAtHold = (await orderRow(O4))!.delivery?.assignedAt?.getTime()
    r = await holdOrder(O4, ADMIN, karachiTomorrow(), 'shop closed')
    row = await orderRow(O4)
    check('On Hold O4: ON_HOLD, stock stays out (116), deductedQty 4, COGS kept',
      r.status === 200 && row?.status === 'ON_HOLD' && (await stock(med.id)) === 116 && row.items[0].deductedQty === 4 && (await cogs(O4)).count === 1, `${r.status} ${JSON.stringify(r.json)}`)
    r = await unassignOrder(O4, ADMIN)
    check('un-assign of an ON_HOLD order -> 409, stock unchanged', r.status === 409 && (await stock(med.id)) === 116, String(r.status))
    r = await assignOrder(O4, drv.id, ADMIN)
    row = await orderRow(O4)
    check('re-assign of the held order: OUT_FOR_DELIVERY, deducts nothing (116), assignedAt and COGS date kept',
      r.status === 200 && row?.status === 'OUT_FOR_DELIVERY' && (await stock(med.id)) === 116 && row.items[0].deductedQty === 4 && row.delivery?.assignedAt?.getTime() === assignedAtHold && (await cogs(O4)).date === assignedAtHold)
    r = await holdOrder(O4, ADMIN, karachiToday(), 'no cash')
    check('hold again (today): 200, stock 116', r.status === 200 && (await stock(med.id)) === 116, `${r.status} ${JSON.stringify(r.json)}`)
    res = await setStatus(O4, 'CANCELLED')
    row = await orderRow(O4)
    item = await item1(O4)
    check('status PUT CANCELLED of an ON_HOLD order: restocked (120), COGS gone, cost cleared, delivery row left as is (ON_HOLD)',
      res.status === 200 && row?.status === 'CANCELLED' && (await stock(med.id)) === 120 && (await cogs(O4)).count === 0 && item.deductedQty === null && item.unitCost === null && row.delivery?.status === 'ON_HOLD')
    res = await setStatus(O4, 'CANCELLED')
    check('CANCELLED again: no further restock', res.status === 200 && (await stock(med.id)) === 120)

    // ---- 9. short stock: assignment refuses; an admin edit-up on an assigned order deducts partially; cancel restocks only what left ----
    const medS = await mkMed('S')
    const BS = await prisma.medicineBatch.create({ data: { medicineId: medS.id, batchNumber: 'QAR-S1', expiryDate: new Date('2030-01-01'), quantityIn: 3, currentQty: 3, purchasePrice: 40, tradePrice: 80 } })
    const O5 = await mkOrder(medS.id, 5)
    await confirm(O5)
    r = await assignOrder(O5, drv.id, ADMIN)
    row = await orderRow(O5)
    check('assign with short stock (5 ordered, 3 in stock) -> 409 naming the medicine; nothing changed',
      r.status === 409 && /Not enough stock/.test(r.json?.error ?? '') && row?.status === 'INVOICED' && row.items[0].deductedQty === null && !row.delivery?.driverId && (await batchQty(BS.id)) === 3 && (await cogs(O5)).count === 0, `${r.status} ${r.json?.error}`)
    res = await api(`/api/orders/${O5}`, ADMIN, { method: 'DELETE' })
    check('cancel of the refused (INVOICED) order: nothing restocked (3)', res.status === 200 && (await batchQty(BS.id)) === 3)
    const O5b = await mkOrder(medS.id, 2)
    await confirmAndAssign(O5b)
    check('assign O5b (2 of 3): batch 1 left, deductedQty 2', (await batchQty(BS.id)) === 1 && (await item1(O5b)).deductedQty === 2)
    res = await editQty(O5b, (await item1(O5b)).id, 5)
    j = await json(res)
    check('admin edit +3 with only 1 in stock: 200 with a warning, batch 0, deductedQty 3 (what actually left)',
      res.status === 200 && Array.isArray(j?.warnings) && j.warnings.length > 0 && (await batchQty(BS.id)) === 0 && (await item1(O5b)).deductedQty === 3, JSON.stringify(j?.warnings))
    res = await api(`/api/orders/${O5b}`, ADMIN, { method: 'DELETE' })
    check('cancel shortfall order: restocks 3 (not 5)', res.status === 200 && (await batchQty(BS.id)) === 3)

    // ---- 10. admin edit of an OUT_FOR_DELIVERY order keeps deductedQty consistent ----
    const O6 = await mkOrder(med.id, 10)
    await confirmAndAssign(O6) // 120 -> 110
    const it6 = await item1(O6)
    res = await editQty(O6, it6.id, 13)
    check('admin edit +3: stock 107, deductedQty 13', res.status === 200 && (await stock(med.id)) === 107 && (await prisma.orderItem.findUnique({ where: { id: it6.id } }))!.deductedQty === 13)
    res = await editQty(O6, it6.id, 8)
    check('admin edit -5: stock 112, deductedQty 8', res.status === 200 && (await stock(med.id)) === 112 && (await prisma.orderItem.findUnique({ where: { id: it6.id } }))!.deductedQty === 8)
    check('COGS follows the edits (8 units at the blended cost)', (await cogs(O6)).count === 1 && (await cogs(O6)).amount === paisa(8 * Number((await prisma.orderItem.findUnique({ where: { id: it6.id } }))!.unitCost)))
    res = await api(`/api/orders/${O6}`, ADMIN, { method: 'DELETE' })
    check('cancel after edits: restocks 8 (stock 120), COGS gone', res.status === 200 && (await stock(med.id)) === 120 && (await cogs(O6)).count === 0)

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
    const mgrCancel = await setStatus(O6, 'CANCELLED', MGR)
    check('status route CANCELLED by a MANAGER -> 403 (goes through the delete approval instead)', mgrCancel.status === 403, String(mgrCancel.status))

    // ---- 12. COGS in a locked period: cancel / hard delete / status CANCELLED / un-assign / approval refused; assign refused ----
    {
      const O8 = await mkOrder(med.id, 3)
      await confirmAndDeliver(O8) // 117
      const O8b = await mkOrder(med.id, 2)
      await confirmAndAssign(O8b) // 115 (OUT_FOR_DELIVERY)
      const O8c = await mkOrder(med.id, 1)
      await confirm(O8c) // INVOICED, not assigned
      const cogs8 = await cogs(O8)
      const cogs8b = await cogs(O8b)
      const goLive = (await prisma.accountingSettings.findFirst())!.goLiveDate!
      await prisma.accountingSettings.updateMany({ data: { lockedThrough: goLive } }) // today's COGS (assignment) date is now locked
      const unchanged = async () => (await stock(med.id)) === 115 && (await orderRow(O8))?.status === 'DELIVERED' && (await orderRow(O8b))?.status === 'OUT_FOR_DELIVERY' &&
        JSON.stringify(await cogs(O8)) === JSON.stringify(cogs8) && JSON.stringify(await cogs(O8b)) === JSON.stringify(cogs8b) &&
        (await item1(O8)).deductedQty === 3 && (await item1(O8b)).deductedQty === 2
      res = await api(`/api/orders/${O8}`, ADMIN, { method: 'DELETE' })
      check('locked COGS: soft cancel -> 409 with message, stock/status/COGS unchanged', res.status === 409 && (await json(res))?.error === COGS_LOCKED && cogs8.count === 1 && (await unchanged()))
      res = await api(`/api/orders/${O8}?hard=true`, ADMIN, { method: 'DELETE' })
      check('locked COGS: hard delete -> 409, order still there, unchanged', res.status === 409 && (await unchanged()))
      res = await setStatus(O8, 'CANCELLED')
      check('locked COGS: status PUT CANCELLED -> 409, unchanged, delivery still DELIVERED', res.status === 409 && (await unchanged()) && (await orderRow(O8))?.delivery?.status === 'DELIVERED')
      r = await unassignOrder(O8b, ADMIN)
      check('locked COGS: un-assign -> 409 with message, unchanged, driver kept', r.status === 409 && r.json?.error === COGS_LOCKED && (await unchanged()) && (await orderRow(O8b))?.delivery?.driverId === drv.id, `${r.status} ${r.json?.error}`)
      r = await assignOrder(O8c, drv.id, ADMIN)
      check('locked period: assigning today -> 409, nothing deducted, still INVOICED', r.status === 409 && /locked accounting period/.test(r.json?.error ?? '') && (await unchanged()) && (await orderRow(O8c))?.status === 'INVOICED', `${r.status} ${r.json?.error}`)
      res = await api(`/api/orders/${O8}`, MGR, { method: 'DELETE' })
      const ap = await json(res)
      if (ap?.approvalId) created.approvals.push(ap.approvalId)
      res = await api(`/api/approvals/${ap.approvalId}`, ADMIN, { method: 'POST', body: JSON.stringify({ action: 'APPROVE' }) })
      check('locked COGS: MANAGER cancel approved -> 409, request stays PENDING, unchanged', res.status === 409 && (await prisma.deleteApproval.findUnique({ where: { id: ap.approvalId } }))!.status === 'PENDING' && (await unchanged()))
      await prisma.accountingSettings.updateMany({ data: { lockedThrough: null } })
      res = await api(`/api/approvals/${ap.approvalId}`, ADMIN, { method: 'POST', body: JSON.stringify({ action: 'APPROVE' }) })
      check('after unlock: approval executes the cancel, stock 118, COGS gone', res.status === 200 && (await stock(med.id)) === 118 && (await cogs(O8)).count === 0)
      r = await unassignOrder(O8b, ADMIN)
      check('after unlock: un-assign works, stock 120, COGS gone', r.status === 200 && (await stock(med.id)) === 120 && (await cogs(O8b)).count === 0)
    }

    // ---- 13. concurrency: edit racing a cancel; two racing edits; assign racing a cancel ----
    {
      const O9 = await mkOrder(med.id, 10)
      await confirmAndAssign(O9) // 110
      const it9 = await item1(O9)
      const [e1, c1] = await Promise.all([editQty(O9, it9.id, 13), api(`/api/orders/${O9}`, ADMIN, { method: 'DELETE' })])
      check('edit racing cancel: cancel 200, edit 200 or 409, final stock 120, no COGS, CANCELLED', c1.status === 200 && (e1.status === 200 || e1.status === 409) && (await stock(med.id)) === 120 &&
        (await cogs(O9)).count === 0 && (await orderRow(O9))!.status === 'CANCELLED', `edit ${e1.status}, stock ${await stock(med.id)}`)
      const O10 = await mkOrder(med.id, 10)
      await confirmAndAssign(O10) // 110
      const it10 = await item1(O10)
      const [x1, x2] = await Promise.all([editQty(O10, it10.id, 12), editQty(O10, it10.id, 7)])
      const f10 = (await prisma.orderItem.findUnique({ where: { id: it10.id } }))!
      check('two racing edits: both 200, deductedQty == final quantity, stock == 120 - deductedQty', x1.status === 200 && x2.status === 200 && f10.deductedQty === f10.quantity && (await stock(med.id)) === 120 - f10.quantity,
        `qty ${f10.quantity} deducted ${f10.deductedQty} stock ${await stock(med.id)}`)
      res = await api(`/api/orders/${O10}`, ADMIN, { method: 'DELETE' })
      check('cancel after racing edits: stock 120', res.status === 200 && (await stock(med.id)) === 120)
      const O11 = await mkOrder(med.id, 5)
      await confirm(O11)
      const [ra, rc] = await Promise.all([assignOrder(O11, drv.id, ADMIN), setStatus(O11, 'CANCELLED')])
      const i11 = await item1(O11)
      check('assign racing cancel: cancel 200, assign 200 or 409; end CANCELLED, stock 120, no COGS, deductedQty null',
        rc.status === 200 && (ra.status === 200 || ra.status === 409) && (await orderRow(O11))?.status === 'CANCELLED' && (await stock(med.id)) === 120 && (await cogs(O11)).count === 0 && i11.deductedQty === null,
        `assign ${ra.status} cancel ${rc.status} stock ${await stock(med.id)}`)
    }

    // ---- 14. cancel / delete refused once a delivery collection or a delivery-linked return exists ----
    {
      const PIC = qaDeliveryPictureUrl('qa_restock_proof.jpg')
      if (PIC) {
        const O12 = await mkOrder(med.id, 2)
        await confirmAndAssign(O12) // 118
        r = await recordOutcomeApi(O12, ADMIN, { outcome: 'PAID_FULL', method: 'CASH', pictureUrl: PIC })
        check('Paid in Full (cash) O12: 200, DELIVERED, one unacknowledged collection', r.status === 200 && (await orderRow(O12))?.status === 'DELIVERED' &&
          (await prisma.deliveryCollection.count({ where: { orderId: O12, acknowledgedAt: null } })) === 1, `${r.status} ${JSON.stringify(r.json)}`)
        const cogs12 = await cogs(O12)
        const soft = await api(`/api/orders/${O12}`, ADMIN, { method: 'DELETE' })
        const softMsg = (await json(soft))?.error
        const viaStatus = await setStatus(O12, 'CANCELLED')
        const hard = await api(`/api/orders/${O12}?hard=true`, ADMIN, { method: 'DELETE' })
        const hardMsg = (await json(hard))?.error
        check('with a collection: cancel / status CANCELLED / hard delete -> 409; stock, status, deductedQty and COGS unchanged',
          soft.status === 409 && softMsg === COLLECTION_CANCEL && viaStatus.status === 409 && hard.status === 409 && hardMsg === COLLECTION_DELETE &&
          (await stock(med.id)) === 118 && (await orderRow(O12))?.status === 'DELIVERED' && (await item1(O12)).deductedQty === 2 && JSON.stringify(await cogs(O12)) === JSON.stringify(cogs12),
          `${soft.status} ${softMsg} | ${viaStatus.status} | ${hard.status} ${hardMsg}`)
      } else {
        console.log('SKIP collection refusal: NEXT_PUBLIC_SUPABASE_URL not set (.env.local), a delivery picture URL cannot be built')
      }
      const before = await stock(med.id)
      const O13 = await mkOrder(med.id, 3)
      await confirmAndAssign(O13)
      r = await recordOutcomeApi(O13, ADMIN, { outcome: 'RETURNED', reason: 'not required' })
      const sr13 = await prisma.salesReturn.findFirst({ where: { orderId: O13 } })
      check('Returned O13: 200, RETURNED, delivery-linked sales return, returned stock stays out until acknowledged',
        r.status === 200 && (await orderRow(O13))?.status === 'RETURNED' && !!sr13 && (await stock(med.id)) === before - 3, `${r.status} ${JSON.stringify(r.json)}`)
      const cogs13 = await cogs(O13)
      const soft = await api(`/api/orders/${O13}`, ADMIN, { method: 'DELETE' })
      const softMsg = (await json(soft))?.error
      const viaStatus = await setStatus(O13, 'CANCELLED')
      const hard = await api(`/api/orders/${O13}?hard=true`, ADMIN, { method: 'DELETE' })
      check('with a delivery-linked return: cancel / status CANCELLED / hard delete -> 409; nothing restocked, COGS unchanged',
        soft.status === 409 && softMsg === RETURN_BLOCK && viaStatus.status === 409 && hard.status === 409 &&
        (await stock(med.id)) === before - 3 && (await orderRow(O13))?.status === 'RETURNED' && JSON.stringify(await cogs(O13)) === JSON.stringify(cogs13),
        `${soft.status} ${softMsg} | ${viaStatus.status} | ${hard.status}`)
    }

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
  const srs = (await prisma.salesReturn.findMany({ where: { OR: [{ retailerId: { in: rid } }, { orderId: { in: orders } }] }, select: { id: true } })).map((s) => s.id)
  await prisma.journalEntry.deleteMany({ where: { sourceId: { in: [...orders, ...invs, ...pays, ...srs] } } })
  await prisma.deliveryCollection.deleteMany({ where: { OR: [{ orderId: { in: orders } }, { retailerId: { in: rid } }] } })
  await prisma.salesReturn.deleteMany({ where: { id: { in: srs } } }) // items cascade
  await prisma.payment.deleteMany({ where: { id: { in: pays } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs } } })
  await prisma.deliveryChallan.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.delivery.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.order.deleteMany({ where: { id: { in: orders } } })
  const emp = (await prisma.employee.findMany({ where: { name: { in: [QA_EMPLOYEE, QA_DRIVER] } }, select: { id: true } })).map((e) => e.id)
  const approvals = Array.from(new Set([...created.approvals, ...(await prisma.deleteApproval.findMany({ where: { requestedById: { in: emp } }, select: { id: true } })).map((a) => a.id)]))
  await prisma.notification.deleteMany({ where: { OR: [{ referenceId: { in: approvals } }, { employeeId: { in: emp } }] } })
  await prisma.deleteApproval.deleteMany({ where: { id: { in: approvals } } })
  await prisma.employee.deleteMany({ where: { id: { in: emp } } })
  await prisma.medicineBatch.deleteMany({ where: { medicine: { code: { startsWith: 'QAR' } } } })
  await prisma.medicine.deleteMany({ where: { code: { startsWith: 'QAR' } } })
  await prisma.retailer.deleteMany({ where: { id: { in: rid } } })

  const left = (await prisma.retailer.count({ where: { name: QA_CUSTOMER } })) + (await prisma.medicine.count({ where: { code: { startsWith: 'QAR' } } })) +
    (await prisma.employee.count({ where: { name: { in: [QA_EMPLOYEE, QA_DRIVER] } } })) + (await prisma.order.count()) + (await prisma.invoice.count()) +
    (await prisma.salesReturn.count({ where: { id: { in: srs } } })) + (await prisma.deliveryCollection.count({ where: { orderId: { in: orders } } }))
  check('cleanup: no QA residue (and no orders/invoices left)', left === 0, `(${left})`)
  check('cleanup: journal entries back to 0', (await prisma.journalEntry.count()) === 0)
  const s = await prisma.accountingSettings.findFirst()
  check('cleanup: settings identical to snapshot',
    (s?.goLiveDate?.getTime() ?? null) === (orig?.goLiveDate?.getTime() ?? null) && (s?.lockedThrough?.getTime() ?? null) === (orig?.lockedThrough?.getTime() ?? null) && (s?.defaultBankAccountId ?? null) === (orig?.defaultBankAccountId ?? null))
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
