/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA for the Phase 18 orders/deliveries rework: assignment (stock out), outcomes, acknowledgements,
// cancel rules, role scoping, audit rows, the confirm-vs-cancel race and the status-conversion planner.
// PRODUCTION DB — creates only 'QA DLV ...' records (one customer, two medicines with three batches, employees for
// the assignee roles, small orders and everything they produce), removes all of them plus the AuditLog rows that
// refer to them in `finally`, then prints the leftover count (must be 0).
//
// The dev server MUST run with the ledger sync switched off, because go-live is set on production:
//   DELIVERY_TEST_SKIP_SYNC=1 PDC_TEST_SKIP_SYNC=1 AUDIT_ALLOW_PURGE=1 npx next dev -p 3100
// Run: AUDIT_ALLOW_PURGE=1 npx tsx tests/deliveries/qa-deliveries.ts
// PREFLIGHT: before creating anything the script calls GET /api/deliveries/qa-mode and GET /api/cheques/qa-mode
// (non-production-only diagnostics, always 404 when NODE_ENV=production) and refuses to run unless both report
// `skipSync: true`. It never changes accounting settings and aborts if any journal entry references a QA record.
// It reads (never changes) one active bank account for the Bank collection. Pictures are never uploaded: outcomes
// use a well-formed delivery/ URL that is not backed by a stored object.
// Caveat: a real "Rebuild ledger" run while the QA invoices/payments exist would post them (they are dated today,
// after go-live); cleanup re-syncs any such source after deleting it so the entries are removed.
import { config as loadEnv } from 'dotenv'
import { createHmac, randomBytes } from 'crypto'
import { spawnSync } from 'child_process'
import { prisma, check, BASE } from '../portal/qa-helpers'
import { hashPassword } from '../../lib/utils/auth'
import { planConversion } from '../../lib/orders/convert'
import { boardColumn } from '../../lib/orders/status'

loadEnv({ path: '.env.local' }) // the dev server's AUTH_SECRET / NEXT_PUBLIC_SUPABASE_URL live here (not in .env)

const START = new Date(Date.now() - 5000)
const CUST = 'QA DLV Customer'
const TAG = 'QA-DLV'
const EMP_PREFIX = 'QA DLV '
const PASSWORD = `qa-dlv-${randomBytes(12).toString('hex')}` // random per run: QA logins are live for minutes
const RUN = Date.now().toString(36)
let started = false

function forged(role: string, id: string) {
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret-2026'
  const payload = Buffer.from(JSON.stringify({ id, name: `QA DLV ${role}`, role })).toString('base64url')
  return `sp_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const ADMIN = forged('ADMIN', 'qa-dlv-admin')
const MANAGER = forged('MANAGER', 'qa-dlv-manager')
const ACCOUNTANT = forged('ACCOUNTANT', 'qa-dlv-accountant')

async function call(method: string, path: string, who: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: who },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json: any = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
const karachiDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const today = () => karachiDay(new Date())
const tomorrow = () => karachiDay(new Date(Date.now() + 86400000))

const ids = {
  meds: [] as string[], batches: [] as string[], emps: [] as string[], cust: [] as string[], orders: [] as string[],
}

async function stock(medicineId: string) {
  const b = await prisma.medicineBatch.findMany({ where: { medicineId }, orderBy: { expiryDate: 'asc' }, select: { id: true, currentQty: true } })
  return { total: b.reduce((s, x) => s + x.currentQty, 0), byBatch: b.map((x) => x.currentQty) }
}

let seq = 0
/** QA order in RECEIVED with the given lines, confirmed via the real status route (invoice + delivery + challan). */
async function mkOrder(custId: string, lines: { medicineId: string; quantity: number; unitPrice: number }[], confirm = true) {
  const n = ++seq
  const order = await prisma.order.create({
    data: {
      retailerId: custId, orderNumber: `${TAG}-${RUN}-${n}`, status: 'RECEIVED',
      totalAmount: lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
      items: { create: lines.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.quantity * l.unitPrice })) },
    },
    include: { items: { orderBy: { id: 'asc' } } },
  })
  ids.orders.push(order.id)
  if (confirm) {
    const r = await call('PUT', `/api/orders/${order.id}/status`, ADMIN, { status: 'INVOICED' })
    if (r.status !== 200) throw new Error(`confirm of ${order.orderNumber} failed: ${r.status} ${JSON.stringify(r.json)}`)
  }
  const delivery = await prisma.delivery.findUnique({ where: { orderId: order.id } })
  const invoice = await prisma.invoice.findUnique({ where: { orderId: order.id } })
  return { id: order.id, number: order.orderNumber, items: order.items, deliveryId: delivery?.id ?? '', invoiceId: invoice?.id ?? '' }
}
const orderRow = (id: string) => prisma.order.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } }, delivery: true, invoice: { include: { payments: true } } } })
const assign = (deliveryId: string, driverId: string, who = ADMIN) => call('POST', `/api/deliveries/${deliveryId}/assign`, who, { driverId })
const outcome = (deliveryId: string, who: string, body: Record<string, unknown>) => call('POST', `/api/deliveries/${deliveryId}/outcome`, who, body)

async function login(username: string) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) })
  const m = /sp_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')
  if (res.status !== 200 || !m?.[1]) throw new Error(`login ${username} failed: ${res.status}`)
  return `sp_session=${m[1]}`
}

/** Every QA source id that could ever be a journal-entry sourceId. */
async function qaSourceIds() {
  const custs = (await prisma.retailer.findMany({ where: { name: CUST }, select: { id: true } })).map((r) => r.id)
  const orders = (await prisma.order.findMany({ where: { OR: [{ retailerId: { in: custs } }, { id: { in: ids.orders } }] }, select: { id: true } })).map((o) => o.id)
  const invs = (await prisma.invoice.findMany({ where: { OR: [{ retailerId: { in: custs } }, { orderId: { in: orders } }] }, select: { id: true } })).map((i) => i.id)
  const pays = (await prisma.payment.findMany({ where: { retailerId: { in: custs } }, select: { id: true } })).map((p) => p.id)
  const srs = (await prisma.salesReturn.findMany({ where: { retailerId: { in: custs } }, select: { id: true } })).map((s) => s.id)
  const chq = (await prisma.cheque.findMany({ where: { OR: [{ retailerId: { in: custs } }, { chequeNumber: { startsWith: TAG } }] }, select: { id: true } })).map((c) => c.id)
  const batches = (await prisma.medicineBatch.findMany({ where: { medicineId: { in: ids.meds } }, select: { id: true } })).map((b) => b.id)
  return [...custs, ...orders, ...invs, ...pays, ...srs, ...chq, ...batches]
}
async function assertNoLedger(label: string) {
  const src = await qaSourceIds()
  const n = src.length ? await prisma.journalEntry.count({ where: { sourceId: { in: src } } }) : 0
  check(`no journal entry references QA data (${label})`, n === 0, `entries=${n}`)
  if (n > 0) throw new Error('Ledger entries were created for QA data: is the dev server running with DELIVERY_TEST_SKIP_SYNC=1? Aborting.')
}
async function auditHas(model: string, recordId: string, pred: (changes: any) => boolean) {
  const rows = await prisma.auditLog.findMany({ where: { model, recordId, createdAt: { gte: START } } })
  return rows.some((r) => pred(r.changes as any))
}

async function main() {
  // ---- guards ----
  const foreignR = await prisma.retailer.findMany({ where: { name: { startsWith: 'QA ' }, NOT: { name: CUST } }, select: { name: true } })
  const foreignE = await prisma.employee.findMany({ where: { name: { startsWith: 'QA ' }, NOT: { name: { startsWith: EMP_PREFIX } } }, select: { name: true } })
  const foreignM = await prisma.medicine.findMany({ where: { OR: [{ code: { startsWith: 'QA' } }, { name: { startsWith: 'QA ' } }] }, select: { name: true } })
  if (foreignR.length || foreignE.length || foreignM.length) {
    throw new Error(`Refusing to run: 'QA ...' records exist: ${[...foreignR, ...foreignE, ...foreignM].map((x) => x.name).join(', ')}`)
  }
  if ((await prisma.retailer.count({ where: { name: CUST } })) || (await prisma.employee.count({ where: { name: { startsWith: EMP_PREFIX } } })) ||
      (await prisma.order.count({ where: { orderNumber: { startsWith: TAG } } })) || (await prisma.cheque.count({ where: { chequeNumber: { startsWith: TAG } } }))) {
    throw new Error('QA DLV residue from a previous run exists: remove it first')
  }
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabase) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set (.env.local): outcomes need a delivery picture URL')
  const PIC = `${supabase.replace(/\/+$/, '')}/storage/v1/object/public/retailer-photos/delivery/qa_dlv_proof.jpg`
  const bank = await prisma.account.findFirst({ where: { type: 'ASSET', subType: 'BANK', isActive: true }, orderBy: { code: 'asc' } })
  const ping = await call('GET', '/api/deliveries?orderStatus=INVOICED', ADMIN).catch(() => null)
  if (!ping || ping.status !== 200) throw new Error(`Dev server on ${BASE} not reachable / deliveries API not answering`)
  const dm = await call('GET', '/api/deliveries/qa-mode', ADMIN)
  const pm = await call('GET', '/api/cheques/qa-mode', ADMIN)
  if (dm.status !== 200 || dm.json?.skipSync !== true || pm.status !== 200 || pm.json?.skipSync !== true) {
    throw new Error(`Refusing to run: start the dev server with DELIVERY_TEST_SKIP_SYNC=1 PDC_TEST_SKIP_SYNC=1 (deliveries qa-mode: ${dm.status} ${JSON.stringify(dm.json)}, cheques qa-mode: ${pm.status} ${JSON.stringify(pm.json)})`)
  }
  check('preflight: dev server skips the delivery and PDC ledger syncs', true)
  const jeBefore = await prisma.journalEntry.count()
  started = true

  // ---- data ----
  const mfr = await prisma.manufacturer.findFirst({ select: { id: true } })
  if (!mfr) throw new Error('no manufacturer')
  const m1 = await prisma.medicine.create({ data: { code: `QADLV${RUN}A`, name: 'QA DLV MED A', manufacturerId: mfr.id } })
  const m2 = await prisma.medicine.create({ data: { code: `QADLV${RUN}B`, name: 'QA DLV MED B', manufacturerId: mfr.id } })
  ids.meds.push(m1.id, m2.id)
  const mkBatch = async (medicineId: string, no: string, exp: string, qty: number, pp: number) => {
    const b = await prisma.medicineBatch.create({ data: { medicineId, batchNumber: no, expiryDate: new Date(exp), quantityIn: qty, currentQty: qty, purchasePrice: pp, tradePrice: 100, mrp: 120 } })
    ids.batches.push(b.id)
    return b
  }
  await mkBatch(m1.id, 'QA-DLV-A1', '2030-01-01', 10, 50)
  await mkBatch(m1.id, 'QA-DLV-A2', '2031-01-01', 100, 60)
  await mkBatch(m2.id, 'QA-DLV-B1', '2030-06-01', 20, 30)
  const cust = await prisma.retailer.create({ data: { name: CUST } })
  ids.cust.push(cust.id)
  const mkEmp = async (label: string, role: string) => {
    const username = `qa-dlv-${label}-${RUN}`
    const e = await prisma.employee.create({ data: { name: `${EMP_PREFIX}${label}`, role, username, passwordHash: hashPassword(PASSWORD) } })
    ids.emps.push(e.id)
    return { id: e.id, cookie: await login(username) }
  }
  const A = await mkEmp('Driver A', 'DRIVER')
  const B = await mkEmp('Driver B', 'DRIVER')
  const SR = await mkEmp('Booker', 'SALES_REP')
  const TL = await mkEmp('Team Lead', 'TEAM_LEAD')
  const WH = await mkEmp('Warehouse', 'WAREHOUSE')
  check('setup: QA employees (DRIVER x2, SALES_REP, TEAM_LEAD, WAREHOUSE) log in through /api/auth/login', true)
  const outstanding = async () => Number((await call('GET', `/api/retailers/${cust.id}`, ADMIN)).json?.data?.outstandingBalance)

  // ---- 1. assignment deducts FEFO once; double tap ----
  const O1 = await mkOrder(cust.id, [{ medicineId: m1.id, quantity: 12, unitPrice: 100 }])
  const g1 = await call('PUT', `/api/orders/${O1.id}/status`, ADMIN, { status: 'OUT_FOR_DELIVERY' })
  const g2 = await call('PUT', `/api/orders/${O1.id}/status`, ADMIN, { status: 'DELIVERED' })
  check('generic status route refuses OUT_FOR_DELIVERY and DELIVERED (400)', g1.status === 400 && g2.status === 400, `${g1.status} ${g2.status}`)
  const byA = await assign(O1.deliveryId, A.id, A.cookie)
  check('an assignee (DRIVER) cannot assign -> 403', byA.status === 403, `${byA.status}`)
  const [t1, t2] = await Promise.all([assign(O1.deliveryId, A.id), assign(O1.deliveryId, A.id, MANAGER)])
  const tcodes = [t1.status, t2.status].sort().join(',')
  check('double-tap assign -> exactly one 200 and one 409', tcodes === '200,409', `${tcodes} ${t1.json?.error ?? ''} ${t2.json?.error ?? ''}`)
  const s1 = await stock(m1.id)
  check('assign deducts FEFO once: earliest batch emptied first (10 -> 0, 100 -> 98)', s1.byBatch.join(',') === '0,98', s1.byBatch.join(','))
  const r1 = await orderRow(O1.id)
  check('assigned: order OUT_FOR_DELIVERY, deductedQty 12, unitCost set, delivery has driver + assignedAt',
    r1?.status === 'OUT_FOR_DELIVERY' && r1.items[0].deductedQty === 12 && r1.items[0].unitCost !== null && r1.delivery?.driverId === A.id && !!r1.delivery?.assignedAt && r1.delivery?.status === 'OUT_FOR_DELIVERY',
    `${r1?.status} ded=${r1?.items[0].deductedQty} cost=${r1?.items[0].unitCost}`)
  check('unitCost is the FEFO blend (10x50 + 2x60)/12', Math.abs(Number(r1?.items[0].unitCost) - (10 * 50 + 2 * 60) / 12) < 0.0001, String(r1?.items[0].unitCost))

  // ---- 2. short stock refuses and changes nothing ----
  const O2 = await mkOrder(cust.id, [{ medicineId: m2.id, quantity: 1000, unitPrice: 50 }])
  const m2Before = await stock(m2.id)
  const sh = await assign(O2.deliveryId, A.id)
  const r2 = await orderRow(O2.id)
  check('short stock -> 409 naming the medicine', sh.status === 409 && /Not enough stock for QA DLV MED B/.test(sh.json?.error ?? ''), `${sh.status} ${sh.json?.error}`)
  check('short stock changed nothing (status INVOICED, stock, deductedQty, driver)',
    r2?.status === 'INVOICED' && (await stock(m2.id)).total === m2Before.total && r2.items[0].deductedQty === null && !r2.delivery?.driverId && !r2.delivery?.assignedAt)

  // ---- 2b. the status route's CANCELLED is ADMIN only ----
  const cancelNonAdmin = await Promise.all([MANAGER, A.cookie, TL.cookie, SR.cookie].map((c) => call('PUT', `/api/orders/${O2.id}/status`, c, { status: 'CANCELLED' })))
  check('status route CANCELLED by MANAGER / DRIVER / TEAM_LEAD / SALES_REP -> 403, order still INVOICED',
    cancelNonAdmin.every((r) => r.status === 403) && (await orderRow(O2.id))?.status === 'INVOICED', cancelNonAdmin.map((r) => r.status).join(','))

  // ---- 3. bulk assign: one short, the rest go through; unassign restocks ----
  const O3 = await mkOrder(cust.id, [{ medicineId: m2.id, quantity: 5, unitPrice: 50 }])
  const bulkBad = await call('PUT', '/api/deliveries/bulk', A.cookie, { ids: [O3.deliveryId], driverId: A.id })
  check('bulk assign by an assignee -> 403', bulkBad.status === 403, `${bulkBad.status}`)
  const bulk = await call('PUT', '/api/deliveries/bulk', ADMIN, { ids: [O3.deliveryId, O2.deliveryId], driverId: A.id })
  check('bulk assign with one short order: the other is assigned, the short one refused',
    bulk.status === 200 && bulk.json?.assigned?.length === 1 && bulk.json.assigned[0] === O3.deliveryId && bulk.json?.refused?.length === 1 && bulk.json.refused[0].id === O2.deliveryId && /Not enough stock/.test(bulk.json.refused[0].error),
    JSON.stringify(bulk.json))
  check('bulk: stock for the assigned order left (20 -> 15)', (await stock(m2.id)).total === m2Before.total - 5)
  const un = await call('POST', `/api/deliveries/${O3.deliveryId}/assign`, ADMIN, { unassign: true })
  const r3 = await orderRow(O3.id)
  check('unassign -> 200, order INVOICED, stock restocked, deductedQty/unitCost cleared, driver cleared',
    un.status === 200 && r3?.status === 'INVOICED' && (await stock(m2.id)).total === m2Before.total && r3.items[0].deductedQty === null && r3.items[0].unitCost === null && !r3.delivery?.driverId && !r3.delivery?.assignedAt,
    `${un.status} ${r3?.status} ded=${r3?.items[0].deductedQty}`)
  const unAgain = await call('POST', `/api/deliveries/${O3.deliveryId}/assign`, ADMIN, { unassign: true })
  check('unassign of an INVOICED order -> 409', unAgain.status === 409, `${unAgain.status}`)

  // ---- 4. visibility and permissions (A vs B, assignee roles) ----
  const listA = await call('GET', '/api/deliveries', A.cookie)
  const listB = await call('GET', '/api/deliveries', B.cookie)
  check('DRIVER A sees own delivery; every row is A\'s', listA.status === 200 && listA.json.data.some((d: any) => d.id === O1.deliveryId) && listA.json.data.every((d: any) => d.driverId === A.id), `n=${listA.json?.data?.length}`)
  check('DRIVER B does not see A\'s delivery (even with ?driverId=A)', listB.status === 200 && !listB.json.data.some((d: any) => d.id === O1.deliveryId) &&
    !(await call('GET', `/api/deliveries?driverId=${A.id}`, B.cookie)).json.data.some((d: any) => d.id === O1.deliveryId))
  const oB = await call('GET', `/api/orders/${O1.id}`, B.cookie)
  const oA = await call('GET', `/api/orders/${O1.id}`, A.cookie)
  check('GET /api/orders/[id]: DRIVER B 403, DRIVER A (assignee) 200', oB.status === 403 && oA.status === 200, `${oB.status} ${oA.status}`)
  const lstD = await call('GET', '/api/orders', A.cookie)
  const lstS = await call('GET', '/api/orders', SR.cookie)
  const lstT = await call('GET', '/api/orders', TL.cookie)
  check('GET /api/orders list: DRIVER 403, SALES_REP 403, TEAM_LEAD 200', lstD.status === 403 && lstS.status === 403 && lstT.status === 200, `${lstD.status} ${lstS.status} ${lstT.status}`)
  const outB = await outcome(O1.deliveryId, B.cookie, { outcome: 'PAY_LATER' })
  check('DRIVER B cannot record an outcome on A\'s delivery -> 403', outB.status === 403, `${outB.status} ${outB.json?.error}`)
  const notesB = await call('PUT', `/api/deliveries/${O1.deliveryId}`, B.cookie, { notes: 'QA DLV note' })
  check('DRIVER B cannot edit notes on A\'s delivery -> 403', notesB.status === 403, `${notesB.status}`)
  const reB = await call('PUT', `/api/deliveries/${O1.deliveryId}`, A.cookie, { driverId: B.id })
  check('DRIVER A cannot hand the delivery to someone else -> 403', reB.status === 403, `${reB.status}`)
  const upW = await fetch(`${BASE}/api/deliveries/upload-picture`, { method: 'POST', headers: { cookie: WH.cookie } })
  const upAcc = await fetch(`${BASE}/api/deliveries/upload-picture`, { method: 'POST', headers: { cookie: ACCOUNTANT } })
  const upA = await fetch(`${BASE}/api/deliveries/upload-picture`, { method: 'POST', headers: { cookie: A.cookie, 'content-type': 'application/json' }, body: '{}' })
  check('picture upload: WAREHOUSE/ACCOUNTANT 403; an assignee passes the role check (400 for a non-multipart body, nothing stored)',
    upW.status === 403 && upAcc.status === 403 && upA.status === 400, `${upW.status} ${upAcc.status} ${upA.status}`)
  const badPic = await outcome(O1.deliveryId, A.cookie, { outcome: 'PAID_FULL', method: 'CASH', pictureUrl: 'https://evil.example.com/x.jpg' })
  check('outcome with a picture outside the delivery/ folder -> 400', badPic.status === 400, `${badPic.status} ${badPic.json?.error}`)
  const noPic = await outcome(O1.deliveryId, A.cookie, { outcome: 'PAID_FULL', method: 'CASH' })
  check('Paid in Full without a picture -> 400', noPic.status === 400, `${noPic.status} ${noPic.json?.error}`)

  // DRIVER server-side allowlist (middleware): only My Deliveries and what it needs
  const drvInv = await call('GET', '/api/invoices', A.cookie)
  const drvRet = await call('GET', '/api/retailers', A.cookie)
  const drvNotif = await call('GET', '/api/notifications', A.cookie)
  const drvOwn = await call('GET', '/api/deliveries', A.cookie)
  check('DRIVER allowlist: GET /api/invoices and /api/retailers 403; own GET /api/deliveries and /api/notifications 200',
    drvInv.status === 403 && drvRet.status === 403 && drvNotif.status === 200 && drvOwn.status === 200, `${drvInv.status} ${drvRet.status} ${drvNotif.status} ${drvOwn.status}`)
  const tlInv = await call('GET', '/api/invoices', TL.cookie)
  check('TEAM_LEAD is not affected by the DRIVER allowlist (GET /api/invoices not 403)', tlInv.status !== 403, `${tlInv.status}`)

  // ---- 5. Paid in Full, cash: collection waits for acknowledgement ----
  const out0 = await outstanding()
  const pf = await outcome(O1.deliveryId, A.cookie, { outcome: 'PAID_FULL', method: 'CASH', pictureUrl: PIC })
  const r5 = await orderRow(O1.id)
  const col1 = await prisma.deliveryCollection.findFirst({ where: { orderId: O1.id } })
  check('Paid in Full cash (by the assignee) -> 200, order + delivery DELIVERED, outcome PAID_FULL, deliveredAt',
    pf.status === 200 && r5?.status === 'DELIVERED' && r5.delivery?.status === 'DELIVERED' && r5.delivery?.outcome === 'PAID_FULL' && !!r5.delivery?.deliveredAt && r5.delivery?.outcomeById === A.id,
    `${pf.status} ${pf.json?.error ?? ''} ${r5?.status}`)
  check('cash collection recorded for the full invoice (1200), unacknowledged, no payment', !!col1 && col1.method === 'CASH' && Number(col1.amount) === 1200 && !col1.acknowledgedAt && !col1.paymentId && (r5?.invoice?.payments.length ?? -1) === 0)
  check('until acknowledged: invoice UNPAID and customer outstanding unchanged', r5?.invoice?.status === 'UNPAID' && (await outstanding()) === out0, `${r5?.invoice?.status} ${out0}`)
  const twice = await outcome(O1.deliveryId, A.cookie, { outcome: 'PAY_LATER' })
  check('a second outcome on a DELIVERED order -> 409', twice.status === 409, `${twice.status}`)
  const reassignDone = await assign(O1.deliveryId, A.id)
  check('assigning a DELIVERED order -> 409', reassignDone.status === 409, `${reassignDone.status}`)
  check('stock unchanged by the outcome (still 98 in total)', (await stock(m1.id)).total === 98)
  const accAck = await call('POST', `/api/delivery-acknowledgements/collections/${col1!.id}`, ACCOUNTANT)
  const drvAck = await call('POST', `/api/delivery-acknowledgements/collections/${col1!.id}`, A.cookie)
  check('ACCOUNTANT and DRIVER cannot acknowledge a collection -> 403', accAck.status === 403 && drvAck.status === 403, `${accAck.status} ${drvAck.status}`)
  const pend = await call('GET', '/api/delivery-acknowledgements', MANAGER)
  check('acknowledgement list (MANAGER) shows the pending collection', pend.status === 200 && pend.json.data.collections.some((c: any) => c.id === col1!.id), `${pend.status}`)
  check('acknowledgement list refused for ACCOUNTANT -> 403', (await call('GET', '/api/delivery-acknowledgements', ACCOUNTANT)).status === 403)
  const [k1, k2] = await Promise.all([
    call('POST', `/api/delivery-acknowledgements/collections/${col1!.id}`, ADMIN),
    call('POST', `/api/delivery-acknowledgements/collections/${col1!.id}`, MANAGER),
  ])
  const kcodes = [k1.status, k2.status].sort().join(',')
  const r5b = await orderRow(O1.id)
  const col1b = await prisma.deliveryCollection.findUnique({ where: { id: col1!.id } })
  check('double acknowledge -> exactly one 200 and one 409', kcodes === '200,409', `${kcodes} ${k1.json?.error ?? ''} ${k2.json?.error ?? ''}`)
  check('exactly one CASH payment of 1200 on the invoice, invoice PAID, collection linked',
    r5b?.invoice?.payments.length === 1 && Number(r5b.invoice.payments[0].amount) === 1200 && r5b.invoice.payments[0].method === 'CASH' && r5b.invoice.status === 'PAID' && col1b?.paymentId === r5b.invoice.payments[0].id && !!col1b?.acknowledgedAt,
    `${r5b?.invoice?.payments.length} ${r5b?.invoice?.status}`)
  check('after acknowledgement the customer outstanding dropped by 1200', (await outstanding()) === out0 - 1200)
  await assertNoLedger('after the first acknowledgement')

  // ---- 6. Paid in Full, bank ----
  const a3 = await assign(O3.deliveryId, A.id)
  check('re-assign after unassign -> 200, deducts again (20 -> 15)', a3.status === 200 && (await stock(m2.id)).total === 15, `${a3.status}`)
  if (bank) {
    const noBank = await outcome(O3.deliveryId, A.cookie, { outcome: 'PAID_FULL', method: 'BANK', pictureUrl: PIC })
    check('bank collection without a bank account -> 400', noBank.status === 400, `${noBank.status}`)
    const pb = await outcome(O3.deliveryId, A.cookie, { outcome: 'PAID_FULL', method: 'BANK', bankAccountId: bank.id, pictureUrl: PIC })
    const col3 = await prisma.deliveryCollection.findFirst({ where: { orderId: O3.id } })
    const r6a = await orderRow(O3.id)
    check('Paid in Full by bank -> DELIVERED, BANK collection of 250 with the bank account, no payment, invoice UNPAID until acknowledged',
      pb.status === 200 && r6a?.status === 'DELIVERED' && r6a.invoice?.status === 'UNPAID' && r6a.invoice?.payments.length === 0 && col3?.method === 'BANK' && Number(col3.amount) === 250 && col3.bankAccountId === bank.id && !col3.paymentId,
      `${pb.status} ${pb.json?.error ?? ''}`)
    const kb = await call('POST', `/api/delivery-acknowledgements/collections/${col3!.id}`, MANAGER)
    const r6 = await orderRow(O3.id)
    check('bank collection acknowledged -> one BANK_TRANSFER payment into that bank, invoice PAID',
      kb.status === 200 && r6?.invoice?.payments.length === 1 && r6.invoice.payments[0].method === 'BANK_TRANSFER' && r6.invoice.payments[0].bankAccountId === bank.id && r6.invoice.status === 'PAID',
      `${kb.status} ${kb.json?.error ?? ''}`)
  } else {
    console.log('SKIP bank collection: no active bank account exists (QA never creates one)')
    await outcome(O3.deliveryId, A.cookie, { outcome: 'PAY_LATER' })
  }

  // ---- 7. Paid in Full, cheque (SALES_REP as assignee) ----
  const O4 = await mkOrder(cust.id, [{ medicineId: m1.id, quantity: 3, unitPrice: 100 }])
  check('assign to an Order Booker (SALES_REP) -> 200', (await assign(O4.deliveryId, SR.id)).status === 200)
  const srList = await call('GET', '/api/deliveries', SR.cookie)
  check('SALES_REP sees only own deliveries', srList.status === 200 && srList.json.data.length >= 1 && srList.json.data.every((d: any) => d.driverId === SR.id) && srList.json.data.some((d: any) => d.id === O4.deliveryId))
  check('SALES_REP: own order 200, A\'s order 403', (await call('GET', `/api/orders/${O4.id}`, SR.cookie)).status === 200 && (await call('GET', `/api/orders/${O1.id}`, SR.cookie)).status === 403)
  const chqBase = { outcome: 'PAID_FULL', method: 'CHEQUE', pictureUrl: PIC, chequeNumber: `${TAG}-CHQ-${RUN}`, chequeDate: today(), drawerBank: 'QA Bank' }
  const wrongAmt = await outcome(O4.deliveryId, SR.cookie, { ...chqBase, chequeAmount: '299.00' })
  check('door cheque for a different amount -> 400 naming the amount due', wrongAmt.status === 400 && Number(wrongAmt.json?.amountDue) === 300, `${wrongAmt.status} ${JSON.stringify(wrongAmt.json)}`)
  const pc = await outcome(O4.deliveryId, SR.cookie, { ...chqBase, chequeAmount: '300.00' })
  const chq = pc.json?.data?.chequeId ? await prisma.cheque.findUnique({ where: { id: pc.json.data.chequeId } }) : null
  const r7 = await orderRow(O4.id)
  check('cheque outcome -> DELIVERED, unacknowledged PENDING receivable PDC cheque for 300 with the picture, no payment, invoice UNPAID',
    pc.status === 200 && r7?.status === 'DELIVERED' && chq?.status === 'PENDING' && chq.direction === 'RECEIVABLE' && !chq.acknowledgedAt && Number(chq.amount) === 300 && chq.retailerId === cust.id && chq.pictureUrl === PIC && chq.recordedById === SR.id && r7.invoice?.payments.length === 0 && r7.invoice?.status === 'UNPAID' && (await prisma.deliveryCollection.count({ where: { orderId: O4.id } })) === 0,
    `${pc.status} ${pc.json?.error ?? ''} ${chq?.status}`)

  // ---- 8. Paid with Return: returned stock stays out until acknowledged ----
  const O5 = await mkOrder(cust.id, [{ medicineId: m1.id, quantity: 4, unitPrice: 100 }, { medicineId: m2.id, quantity: 3, unitPrice: 50 }])
  check('assign O5 -> 200', (await assign(O5.deliveryId, A.id)).status === 200)
  const m1AfterO5 = (await stock(m1.id)).total
  const lineA = O5.items.find((i) => i.medicineId === m1.id)!
  const pwr = await outcome(O5.deliveryId, A.cookie, { outcome: 'PAID_WITH_RETURN', method: 'CASH', pictureUrl: PIC, returnedLines: [{ orderItemId: lineA.id, quantity: 2, reason: 'not required' }] })
  const sr5 = await prisma.salesReturn.findFirst({ where: { orderId: O5.id }, include: { items: true } })
  const col5 = await prisma.deliveryCollection.findFirst({ where: { orderId: O5.id } })
  check('Paid with Return -> DELIVERED, delivery-linked sales return (2 units, credit 200, not restocked), cash collection 350',
    pwr.status === 200 && (await orderRow(O5.id))?.status === 'DELIVERED' && !!sr5 && sr5.deliveryId === O5.deliveryId && Number(sr5.totalAmount) === 200 &&
    sr5.items.length === 1 && sr5.items[0].quantity === 2 && !sr5.items[0].restocked && !sr5.items[0].batchId && !sr5.stockAcknowledgedAt && Number(col5?.amount) === 350,
    `${pwr.status} ${pwr.json?.error ?? ''} sr=${sr5?.totalAmount} col=${col5?.amount}`)
  check('returned stock stays out until acknowledged', (await stock(m1.id)).total === m1AfterO5)
  const accR = await call('POST', `/api/delivery-acknowledgements/returns/${sr5!.id}`, ACCOUNTANT)
  check('ACCOUNTANT cannot acknowledge returned stock -> 403', accR.status === 403, `${accR.status}`)
  const [q1, q2] = await Promise.all([
    call('POST', `/api/delivery-acknowledgements/returns/${sr5!.id}`, ADMIN),
    call('POST', `/api/delivery-acknowledgements/returns/${sr5!.id}`, MANAGER),
  ])
  const qcodes = [q1.status, q2.status].sort().join(',')
  const r8 = await orderRow(O5.id)
  const sr5b = await prisma.salesReturn.findUnique({ where: { id: sr5!.id }, include: { items: true } })
  check('double acknowledge of returned stock -> one 200 and one 409', qcodes === '200,409', `${qcodes} ${q1.json?.error ?? ''} ${q2.json?.error ?? ''}`)
  check('returned stock restocked once (+2), item restocked with batch, return acknowledged',
    (await stock(m1.id)).total === m1AfterO5 + 2 && sr5b?.items[0].restocked === true && !!sr5b.items[0].batchId && !!sr5b.stockAcknowledgedAt)
  check('deductedQty of the returned line reduced 4 -> 2; the other line unchanged (3)',
    r8?.items.find((i) => i.id === lineA.id)?.deductedQty === 2 && r8?.items.find((i) => i.id !== lineA.id)?.deductedQty === 3)
  // Cancel/delete/un-deliver of an order with a delivery-linked return or a collection is refused (Task 5 ruling).
  const c5 = await call('DELETE', `/api/orders/${O5.id}`, ADMIN)
  const c5s = await call('PUT', `/api/orders/${O5.id}/status`, ADMIN, { status: 'CANCELLED' })
  const c5h = await call('DELETE', `/api/orders/${O5.id}?hard=true`, ADMIN)
  check('cancel / status CANCELLED / hard delete of an order with a delivery return -> 409, nothing changes',
    c5.status === 409 && c5s.status === 409 && c5h.status === 409 && (await orderRow(O5.id))?.status === 'DELIVERED' && (await stock(m1.id)).total === m1AfterO5 + 2,
    `${c5.status} ${c5s.status} ${c5h.status} ${c5.json?.error}`)
  const c1 = await call('DELETE', `/api/orders/${O1.id}`, ADMIN)
  check('cancel of an order with an (acknowledged) collection and no return -> 409', c1.status === 409 && (await orderRow(O1.id))?.status === 'DELIVERED', `${c1.status} ${c1.json?.error}`)

  // ---- 9. Returned (TEAM_LEAD as assignee) ----
  const O6 = await mkOrder(cust.id, [{ medicineId: m1.id, quantity: 2, unitPrice: 100 }])
  check('assign to a TEAM_LEAD -> 200', (await assign(O6.deliveryId, TL.id)).status === 200)
  const tlList = await call('GET', '/api/deliveries', TL.cookie)
  check('TEAM_LEAD sees only own deliveries', tlList.status === 200 && tlList.json.data.every((d: any) => d.driverId === TL.id) && tlList.json.data.some((d: any) => d.id === O6.deliveryId))
  const m1BeforeRet = (await stock(m1.id)).total
  const badReason = await outcome(O6.deliveryId, TL.cookie, { outcome: 'RETURNED', reason: 'shop closed' })
  check('Returned with a reason not in the list -> 400', badReason.status === 400, `${badReason.status}`)
  const ret = await outcome(O6.deliveryId, TL.cookie, { outcome: 'RETURNED', reason: 'wrong order' })
  const r9 = await orderRow(O6.id)
  const sr6 = await prisma.salesReturn.findFirst({ where: { orderId: O6.id }, include: { items: true } })
  check('Returned -> order + delivery RETURNED, reason stored, sales return of the whole invoice (200), no collection/cheque',
    ret.status === 200 && r9?.status === 'RETURNED' && r9.delivery?.status === 'RETURNED' && r9.delivery?.outcomeReason === 'wrong order' && Number(sr6?.totalAmount) === 200 && sr6?.items[0].quantity === 2 &&
    (await prisma.deliveryCollection.count({ where: { orderId: O6.id } })) === 0,
    `${ret.status} ${ret.json?.error ?? ''}`)
  check('Returned: stock stays out until acknowledged', (await stock(m1.id)).total === m1BeforeRet)
  const ak6 = await call('POST', `/api/delivery-acknowledgements/returns/${sr6!.id}`, MANAGER)
  check('Returned stock acknowledged -> restocked (+2), deductedQty 0', ak6.status === 200 && (await stock(m1.id)).total === m1BeforeRet + 2 && (await orderRow(O6.id))?.items[0].deductedQty === 0, `${ak6.status} ${ak6.json?.error ?? ''}`)
  const c6 = await call('PUT', `/api/orders/${O6.id}/status`, ADMIN, { status: 'CANCELLED' })
  check('cancel of a RETURNED order (delivery-linked return) -> 409, no second restock', c6.status === 409 && (await stock(m1.id)).total === m1BeforeRet + 2, `${c6.status} ${c6.json?.error}`)

  // ---- 10. On Hold keeps stock out; READY again on its date; re-assign deducts nothing; Pay Later ----
  const O7 = await mkOrder(cust.id, [{ medicineId: m2.id, quantity: 2, unitPrice: 50 }])
  check('assign O7 -> 200', (await assign(O7.deliveryId, A.id)).status === 200)
  const m2Held = (await stock(m2.id)).total
  const past = await outcome(O7.deliveryId, A.cookie, { outcome: 'ON_HOLD', reason: 'no cash', holdUntil: karachiDay(new Date(Date.now() - 3 * 86400000)) })
  check('On Hold with a past date -> 400', past.status === 400, `${past.status}`)
  const hold = await outcome(O7.deliveryId, A.cookie, { outcome: 'ON_HOLD', reason: 'shop closed', holdUntil: today() })
  const r10 = await orderRow(O7.id)
  check('On Hold -> order + delivery ON_HOLD, reason stored, driver kept, scheduled for the hold date',
    hold.status === 200 && r10?.status === 'ON_HOLD' && r10.delivery?.status === 'ON_HOLD' && r10.delivery?.outcomeReason === 'shop closed' && r10.delivery?.driverId === A.id && karachiDay(r10.delivery!.scheduledDate) === today(),
    `${hold.status} ${hold.json?.error ?? ''}`)
  check('On Hold keeps the stock out (deductedQty 2, stock unchanged)', (await stock(m2.id)).total === m2Held && r10?.items[0].deductedQty === 2)
  const held = await call('GET', '/api/deliveries?orderStatus=ON_HOLD', ADMIN)
  const hd = held.json?.data?.find((d: any) => d.id === O7.deliveryId)
  check('held order due today shows in Ready to Dispatch (boardColumn READY)', !!hd && boardColumn(hd.order, { scheduledDate: new Date(hd.scheduledDate) }, new Date()) === 'READY')
  const reHold = await assign(O7.deliveryId, B.id)
  const r10b = await orderRow(O7.id)
  check('re-assign of the held order to B -> OUT_FOR_DELIVERY, deducts nothing, assignedAt kept',
    reHold.status === 200 && r10b?.status === 'OUT_FOR_DELIVERY' && (await stock(m2.id)).total === m2Held && r10b.items[0].deductedQty === 2 && r10b.delivery?.driverId === B.id &&
    r10b.delivery?.assignedAt?.getTime() === r10?.delivery?.assignedAt?.getTime(), `${reHold.status} ${reHold.json?.error ?? ''}`)
  const listA2 = await call('GET', '/api/deliveries', A.cookie)
  check('after hand-over A no longer sees the delivery; A cannot record its outcome (403)',
    !listA2.json.data.some((d: any) => d.id === O7.deliveryId) && (await outcome(O7.deliveryId, A.cookie, { outcome: 'PAY_LATER' })).status === 403)
  const pl = await outcome(O7.deliveryId, B.cookie, { outcome: 'PAY_LATER' })
  const r10c = await orderRow(O7.id)
  check('Pay Later (by B) -> DELIVERED, no collection, no cheque, invoice UNPAID',
    pl.status === 200 && r10c?.status === 'DELIVERED' && r10c.delivery?.outcome === 'PAY_LATER' && r10c.invoice?.status === 'UNPAID' &&
    (await prisma.deliveryCollection.count({ where: { orderId: O7.id } })) === 0 && !pl.json?.data?.chequeId, `${pl.status} ${pl.json?.error ?? ''}`)

  // ---- 11. cancel of an ON_HOLD / OUT_FOR_DELIVERY order restocks ----
  const O8 = await mkOrder(cust.id, [{ medicineId: m2.id, quantity: 1, unitPrice: 50 }])
  await assign(O8.deliveryId, A.id)
  const m2O8 = (await stock(m2.id)).total
  const h8 = await outcome(O8.deliveryId, A.cookie, { outcome: 'ON_HOLD', reason: 'no cash', holdUntil: tomorrow() })
  const held8 = (await call('GET', '/api/deliveries?orderStatus=ON_HOLD', ADMIN)).json?.data?.find((d: any) => d.id === O8.deliveryId)
  check('held until tomorrow -> boardColumn ON_HOLD', h8.status === 200 && !!held8 && boardColumn(held8.order, { scheduledDate: new Date(held8.scheduledDate) }, new Date()) === 'ON_HOLD')
  const c8 = await call('PUT', `/api/orders/${O8.id}/status`, ADMIN, { status: 'CANCELLED' })
  const r11 = await orderRow(O8.id)
  check('cancel of an ON_HOLD order -> CANCELLED, stock restocked (+1), deductedQty cleared',
    c8.status === 200 && r11?.status === 'CANCELLED' && (await stock(m2.id)).total === m2O8 + 1 && r11.items[0].deductedQty === null, `${c8.status} ${c8.json?.error ?? ''}`)
  const O9 = await mkOrder(cust.id, [{ medicineId: m1.id, quantity: 1, unitPrice: 100 }])
  await assign(O9.deliveryId, A.id)
  const m1O9 = (await stock(m1.id)).total
  const c9 = await call('DELETE', `/api/orders/${O9.id}`, ADMIN)
  const r11b = await orderRow(O9.id)
  check('cancel (DELETE) of an OUT_FOR_DELIVERY order -> CANCELLED, stock restocked (+1)',
    c9.status === 200 && r11b?.status === 'CANCELLED' && (await stock(m1.id)).total === m1O9 + 1 && r11b.items[0].deductedQty === null, `${c9.status} ${c9.json?.error ?? ''}`)

  // ---- 11b. admin edit is refused once an outcome / collection / delivery return exists ----
  // Bodies repeat the stored values; the guard refuses before anything is written or synced.
  const editBody = async (orderId: string) => ({
    items: (await orderRow(orderId))!.items.map((i) => ({
      id: i.id, quantity: i.quantity, unitPrice: Number(i.unitPrice), offerPercent: Number(i.offerPercent),
      salesTax: Number(i.salesTax), bonusQty: i.bonusQty, mrp: i.mrp === null ? null : Number(i.mrp),
    })),
  })
  const eCol = await call('PUT', `/api/orders/${O1.id}`, ADMIN, await editBody(O1.id))
  const eRet = await call('PUT', `/api/orders/${O6.id}`, ADMIN, await editBody(O6.id))
  const eOut = await call('PUT', `/api/orders/${O7.id}`, ADMIN, await editBody(O7.id))
  check('admin edit refused 409: order with a collection (O1), a delivery return (O6), a recorded outcome (O7 Pay Later)',
    eCol.status === 409 && /collection/i.test(eCol.json?.error ?? '') && eRet.status === 409 && /return/i.test(eRet.json?.error ?? '') &&
    eOut.status === 409 && /outcome/i.test(eOut.json?.error ?? ''), `${eCol.status} ${eCol.json?.error} | ${eRet.status} ${eRet.json?.error} | ${eOut.status} ${eOut.json?.error}`)
  await assertNoLedger('after the refused admin edits')

  // ---- 11c. an OUT_FOR_DELIVERY order whose stock never left (converted DISPATCHED) cannot get an outcome ----
  const U = await prisma.order.create({
    data: {
      retailerId: cust.id, orderNumber: `${TAG}-${RUN}-UNDEDUCTED`, status: 'OUT_FOR_DELIVERY', totalAmount: 100,
      items: { create: [{ medicineId: m1.id, quantity: 1, unitPrice: 100, lineTotal: 100 }] }, // deductedQty null
    },
  })
  ids.orders.push(U.id)
  await prisma.invoice.create({ data: { invoiceNumber: `${TAG}-${RUN}-UINV`, orderId: U.id, retailerId: cust.id, subtotal: 100, totalAmount: 100 } })
  const UD = await prisma.delivery.create({ data: { orderId: U.id, driverId: A.id, scheduledDate: new Date(), status: 'OUT_FOR_DELIVERY' } })
  const m1U = (await stock(m1.id)).total
  const uo = await outcome(UD.id, A.cookie, { outcome: 'PAY_LATER' })
  const uoAdmin = await outcome(UD.id, ADMIN, { outcome: 'PAY_LATER' })
  check('outcome on an OUT_FOR_DELIVERY order with null deductedQty -> 409 (assignee and admin), order unchanged',
    uo.status === 409 && /un-assign and assign it again/.test(uo.json?.error ?? '') && uoAdmin.status === 409 && (await orderRow(U.id))?.status === 'OUT_FOR_DELIVERY',
    `${uo.status} ${uo.json?.error} | ${uoAdmin.status}`)
  const uUn = await call('POST', `/api/deliveries/${UD.id}/assign`, ADMIN, { unassign: true })
  check('recovery: un-assign restocks nothing (stock never left)', uUn.status === 200 && (await stock(m1.id)).total === m1U && (await orderRow(U.id))?.status === 'INVOICED', `${uUn.status} ${uUn.json?.error ?? ''}`)
  const uAs = await assign(UD.id, A.id)
  check('recovery: assign again deducts the stock (-1, deductedQty 1)', uAs.status === 200 && (await stock(m1.id)).total === m1U - 1 && (await orderRow(U.id))?.items[0].deductedQty === 1, `${uAs.status}`)
  const uPl = await outcome(UD.id, A.cookie, { outcome: 'PAY_LATER' })
  check('recovery: the outcome is then accepted (Pay Later -> DELIVERED)', uPl.status === 200 && (await orderRow(U.id))?.status === 'DELIVERED', `${uPl.status} ${uPl.json?.error ?? ''}`)

  // ---- 12. confirm vs cancel race ----
  for (let i = 0; i < 3; i++) {
    const R = await mkOrder(cust.id, [{ medicineId: m2.id, quantity: 1, unitPrice: 50 }], false)
    const [ci, cc] = await Promise.all([
      call('PUT', `/api/orders/${R.id}/status`, ADMIN, { status: 'INVOICED' }),
      call('PUT', `/api/orders/${R.id}/status`, ADMIN, { status: 'CANCELLED' }),
    ])
    const row = await orderRow(R.id)
    const inv = !!row?.invoice
    check(`confirm-vs-cancel race #${i + 1}: end state CANCELLED, cancel 200, invoice exists only if confirm won (confirm ${ci.status})`,
      row?.status === 'CANCELLED' && cc.status === 200 && ((ci.status === 200 && inv) || (ci.status === 409 && !inv)), `${ci.status} ${cc.status} status=${row?.status} invoice=${inv}`)
  }

  // ---- 13. audit rows ----
  check('audit: assignment logged (Order status -> OUT_FOR_DELIVERY and Delivery assignedAt)',
    (await auditHas('Order', O1.id, (c) => c?.status?.to === 'OUT_FOR_DELIVERY')) && (await auditHas('Delivery', O1.deliveryId, (c) => !!c?.assignedAt)))
  check('audit: outcome logged (Delivery outcome -> PAID_FULL)', await auditHas('Delivery', O1.deliveryId, (c) => c?.outcome?.to === 'PAID_FULL'))
  check('audit: collection acknowledgement logged (DeliveryCollection acknowledgedAt) and the payment CREATE',
    (await auditHas('DeliveryCollection', col1!.id, (c) => !!c?.acknowledgedAt)) &&
    (await prisma.auditLog.count({ where: { model: 'Payment', action: 'CREATE', recordId: col1b!.paymentId! } })) === 1)
  check('audit: returned-stock acknowledgement logged (SalesReturn stockAcknowledgedAt)', await auditHas('SalesReturn', sr5!.id, (c) => !!c?.stockAcknowledgedAt))
  const actorRow = await prisma.auditLog.findFirst({ where: { model: 'Delivery', recordId: O1.deliveryId, actorId: A.id } })
  check('audit: the outcome row carries the driver as actor', !!actorRow && actorRow.actorRole === 'DRIVER')

  // ---- 14. status conversion planner on QA fixtures; --apply without --backup refuses ----
  const legacy = ['PENDING', 'CONFIRMED', 'PICKING', 'DISPATCHED', 'DRAFT', 'DELIVERED']
  const fx: Record<string, string> = {}
  for (const st of legacy) {
    const o = await prisma.order.create({
      data: { retailerId: cust.id, orderNumber: `${TAG}-${RUN}-CONV-${st}`, status: st, totalAmount: 50, items: { create: [{ medicineId: m2.id, quantity: 1, unitPrice: 50, lineTotal: 50 }] } },
    })
    ids.orders.push(o.id)
    fx[st] = o.id
  }
  const rows = await prisma.order.findMany({ where: { id: { in: Object.values(fx) } }, include: { items: { select: { deductedQty: true } }, delivery: { select: { status: true } } } })
  const plan = planConversion(rows.map((o) => ({ id: o.id, orderNumber: o.orderNumber, status: o.status, deliveryStatus: o.delivery?.status ?? null, items: o.items })))
  const upd = (st: string) => plan.updates.find((u) => u.id === fx[st])
  check('conversion plan: PENDING->RECEIVED, CONFIRMED/PICKING->INVOICED (delivery SCHEDULED), DISPATCHED->OUT_FOR_DELIVERY, DELIVERED untouched',
    upd('PENDING')?.to === 'RECEIVED' && upd('CONFIRMED')?.to === 'INVOICED' && upd('CONFIRMED')?.deliveryStatus === 'SCHEDULED' && upd('PICKING')?.to === 'INVOICED' &&
    upd('DISPATCHED')?.to === 'OUT_FOR_DELIVERY' && upd('DISPATCHED')?.deliveryStatus === null && !upd('DELIVERED') && plan.updates.length === 4,
    JSON.stringify(plan.updates.map((u) => [u.from, u.to, u.deliveryStatus])))
  check('conversion plan: DRAFT deleted, DISPATCHED (never deducted) flagged for manual review',
    plan.deletes.length === 1 && plan.deletes[0] === fx.DRAFT && plan.review.length === 1 && plan.review[0].id === fx.DISPATCHED, JSON.stringify({ d: plan.deletes.length, r: plan.review }))
  console.log('  conversion plan on QA fixtures:', JSON.stringify({ counts: plan.counts, updates: plan.updates.map((u) => `${u.from}->${u.to}`), deletes: plan.deletes.length, review: plan.review.length }))
  // Invalid DATABASE_URL/DIRECT_URL: even if the refusal were broken, the script could not reach the real database.
  const badDb = 'postgresql://qa:qa@127.0.0.1:1/qa_no_such_db'
  const run = (args: string[]) => spawnSync('npx', ['tsx', 'scripts/convert-order-statuses.ts', ...args], {
    shell: true, encoding: 'utf8', timeout: 120000, env: { ...process.env, DATABASE_URL: badDb, DIRECT_URL: badDb },
  })
  const x1 = run(['--apply'])
  const x2 = run(['--apply', '--backup'])
  check('convert script: --apply without --backup refuses (exit 1, "Refusing"), also with --backup but no path',
    x1.status === 1 && /Refusing to --apply without --backup/.test(x1.stderr) && x2.status === 1 && /Refusing/.test(x2.stderr), `${x1.status} ${x1.stderr?.trim()} | ${x2.status}`)
  const after = await prisma.order.findMany({ where: { id: { in: Object.values(fx) } }, select: { id: true, status: true } })
  check('convert script refusal changed nothing (QA legacy fixtures keep their statuses, DRAFT still there)',
    after.length === legacy.length && after.every((o) => fx[o.status] === o.id))

  await assertNoLedger('end')
  const jeAfter = await prisma.journalEntry.count()
  console.log(`  journal entries total: before ${jeBefore}, after ${jeAfter} (any difference would be real concurrent use; QA-referencing entries checked above)`)
}

async function cleanup() {
  if (!started) return
  const custs = (await prisma.retailer.findMany({ where: { OR: [{ name: CUST }, { id: { in: ids.cust } }] }, select: { id: true } })).map((r) => r.id)
  const orders = (await prisma.order.findMany({ where: { OR: [{ retailerId: { in: custs } }, { id: { in: ids.orders } }, { orderNumber: { startsWith: TAG } }] }, select: { id: true } })).map((o) => o.id)
  const items = (await prisma.orderItem.findMany({ where: { orderId: { in: orders } }, select: { id: true } })).map((i) => i.id)
  const dels = (await prisma.delivery.findMany({ where: { orderId: { in: orders } }, select: { id: true } })).map((d) => d.id)
  const cols = (await prisma.deliveryCollection.findMany({ where: { OR: [{ orderId: { in: orders } }, { retailerId: { in: custs } }] }, select: { id: true } })).map((c) => c.id)
  const challans = (await prisma.deliveryChallan.findMany({ where: { orderId: { in: orders } }, select: { id: true } })).map((c) => c.id)
  const invs = (await prisma.invoice.findMany({ where: { OR: [{ orderId: { in: orders } }, { retailerId: { in: custs } }] }, select: { id: true } })).map((i) => i.id)
  const pays = (await prisma.payment.findMany({ where: { OR: [{ retailerId: { in: custs } }, { invoiceId: { in: invs } }] }, select: { id: true } })).map((p) => p.id)
  const cheques = (await prisma.cheque.findMany({ where: { OR: [{ retailerId: { in: custs } }, { chequeNumber: { startsWith: TAG } }] }, select: { id: true } })).map((c) => c.id)
  const srs = (await prisma.salesReturn.findMany({ where: { OR: [{ retailerId: { in: custs } }, { orderId: { in: orders } }] }, select: { id: true } })).map((s) => s.id)
  const sris = (await prisma.salesReturnItem.findMany({ where: { salesReturnId: { in: srs } }, select: { id: true } })).map((s) => s.id)
  const meds = (await prisma.medicine.findMany({ where: { OR: [{ id: { in: ids.meds } }, { name: { startsWith: 'QA DLV ' } }] }, select: { id: true } })).map((m) => m.id)
  const batches = (await prisma.medicineBatch.findMany({ where: { medicineId: { in: meds } }, select: { id: true } })).map((b) => b.id)
  const emps = (await prisma.employee.findMany({ where: { OR: [{ id: { in: ids.emps } }, { name: { startsWith: EMP_PREFIX } }] }, select: { id: true } })).map((e) => e.id)
  const all = new Set([...custs, ...orders, ...items, ...dels, ...cols, ...challans, ...invs, ...pays, ...cheques, ...srs, ...sris, ...meds, ...batches, ...emps])

  // Safety: everything below is scoped to these ids. A foreign row referencing a QA batch/medicine/employee would
  // block a delete (FK) and is reported, never removed.
  await prisma.deliveryCollection.deleteMany({ where: { id: { in: cols } } })
  await prisma.payment.deleteMany({ where: { id: { in: pays } } })
  await prisma.cheque.deleteMany({ where: { id: { in: cheques } } })
  await prisma.salesReturn.deleteMany({ where: { id: { in: srs } } }) // items cascade
  await prisma.deliveryChallan.deleteMany({ where: { id: { in: challans } } })
  await prisma.delivery.deleteMany({ where: { id: { in: dels } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs } } })
  await prisma.order.deleteMany({ where: { id: { in: orders } } }) // items cascade
  await prisma.medicineBatch.deleteMany({ where: { id: { in: batches } } })
  await prisma.medicine.deleteMany({ where: { id: { in: meds } } })
  await prisma.retailer.deleteMany({ where: { id: { in: custs } } })
  await prisma.employee.deleteMany({ where: { id: { in: emps } } })

  // Should never happen (assertNoLedger aborts): if a QA source was posted, re-sync it now that it is gone.
  const jes = await prisma.journalEntry.findMany({ where: { sourceId: { in: Array.from(all) } }, select: { sourceType: true, sourceId: true } })
  if (jes.length) {
    console.error('WARNING: journal entries referenced QA data; re-syncing their sources to remove them', jes)
    const { syncAllSafe } = await import('../../lib/accounting/sync')
    await syncAllSafe(jes.map((x) => [x.sourceType as any, x.sourceId]))
  }

  const ours = (x: { recordId: string | null; changes: unknown; actorId: string | null }) => {
    if (x.recordId && all.has(x.recordId)) return true
    if (x.actorId && (x.actorId.startsWith('qa-dlv-') || all.has(x.actorId))) return true
    const text = JSON.stringify(x.changes ?? null)
    return text.includes('QA DLV') || text.includes(TAG) || text.includes('qa-dlv-') || Array.from(all).some((id) => text.includes(id))
  }
  const mineOf = async () => (await prisma.auditLog.findMany({ where: { createdAt: { gte: START } } })).filter(ours)
  const mine = await mineOf()
  const prev = process.env.AUDIT_ALLOW_PURGE
  process.env.AUDIT_ALLOW_PURGE = '1'
  try {
    if (mine.length) await prisma.auditLog.deleteMany({ where: { id: { in: mine.map((x) => x.id) } } })
  } finally {
    if (prev === undefined) delete process.env.AUDIT_ALLOW_PURGE
    else process.env.AUDIT_ALLOW_PURGE = prev
  }

  const counts: Record<string, number> = {
    retailer: await prisma.retailer.count({ where: { OR: [{ name: CUST }, { id: { in: custs } }] } }),
    order: await prisma.order.count({ where: { OR: [{ id: { in: orders } }, { orderNumber: { startsWith: TAG } }] } }),
    delivery: await prisma.delivery.count({ where: { id: { in: dels } } }),
    collection: await prisma.deliveryCollection.count({ where: { id: { in: cols } } }),
    challan: await prisma.deliveryChallan.count({ where: { id: { in: challans } } }),
    invoice: await prisma.invoice.count({ where: { id: { in: invs } } }),
    payment: await prisma.payment.count({ where: { id: { in: pays } } }),
    cheque: await prisma.cheque.count({ where: { OR: [{ id: { in: cheques } }, { chequeNumber: { startsWith: TAG } }] } }),
    salesReturn: await prisma.salesReturn.count({ where: { id: { in: srs } } }),
    medicine: await prisma.medicine.count({ where: { OR: [{ id: { in: meds } }, { name: { startsWith: 'QA DLV ' } }] } }),
    batch: await prisma.medicineBatch.count({ where: { id: { in: batches } } }),
    employee: await prisma.employee.count({ where: { OR: [{ id: { in: emps } }, { name: { startsWith: EMP_PREFIX } }] } }),
    journalEntry: await prisma.journalEntry.count({ where: { sourceId: { in: Array.from(all) } } }),
    auditLog: (await mineOf()).length,
  }
  const left = Object.values(counts).reduce((s, n) => s + n, 0)
  if (left) console.log('Leftovers by table:', counts)
  console.log(`Leftover QA rows: ${left}`)
  if (left !== 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { try { await cleanup() } catch (e) { console.error('CLEANUP FAILED', e); process.exitCode = 1 } await prisma.$disconnect() })
