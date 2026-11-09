/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA for PDC (post-dated cheque) management: /api/cheques*, clearing, and the payment routes.
// PRODUCTION DB — creates only 'QA PDC ...' records (one customer, one supplier, tiny invoices, cheques), removes all of
// them plus the AuditLog rows that refer to them in `finally`, then prints the leftover count (must be 0).
//
// The dev server MUST run with the ledger switched off for clearing, because go-live is set on production:
//   PDC_TEST_SKIP_SYNC=1 AUDIT_ALLOW_PURGE=1 npx next dev -p 3100
// Run: AUDIT_ALLOW_PURGE=1 npx tsx tests/pdc/qa-pdc.ts
// PREFLIGHT: before creating anything the script calls GET /api/cheques/qa-mode (a non-production-only diagnostic,
// always 404 when NODE_ENV=production) and refuses to run unless the server reports `skipSync: true`.
// It never changes accounting settings and never posts journal entries: the cleared-cheque payments are not synced
// (PDC_TEST_SKIP_SYNC) and the one CASH payment is dated before go-live (sync skips it). It aborts if any journal
// entry ever references a QA record. Concurrent real use is fine, except a "Rebuild ledger" run during the few
// seconds the QA payments exist would post them (cleanup then re-syncs those sources to remove the entries).
import { createHmac } from 'crypto'
import { prisma, check, BASE } from '../portal/qa-helpers'

const START = new Date(Date.now() - 5000)
const CUST = 'QA PDC Customer'
const SUPP = 'QA PDC Supplier'
const TAG = 'QA-PDC'
const CASH_DATE = '2026-10-01' // before the production go-live (2026-10-11): the sync skips it, no journal entry
let started = false

function cookie(role: string, id: string) {
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret-2026'
  const payload = Buffer.from(JSON.stringify({ id, name: `QA PDC ${role}`, role })).toString('base64url')
  return `sp_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const ADMIN = cookie('ADMIN', 'qa-pdc-admin')
const MANAGER = cookie('MANAGER', 'qa-pdc-manager')
const ACCOUNTANT = cookie('ACCOUNTANT', 'qa-pdc-accountant')
const SALESMAN = cookie('SALESMAN', 'qa-pdc-salesman')
const SALESMAN2 = cookie('SALESMAN', 'qa-pdc-salesman2')

async function call(method: string, path: string, who: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: who },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json: any = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })

async function newCheque(who: string, body: Record<string, unknown>) {
  const r = await call('POST', '/api/cheques', who, {
    direction: 'RECEIVABLE', chequeDate: today(), ...body,
  })
  return r
}
const status = (id: string, who: string, action: string, extra: Record<string, unknown> = {}) =>
  call('POST', `/api/cheques/${id}/status`, who, { action, ...extra })

async function invoiceState(ids: string[]) {
  const rows = await prisma.invoice.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, payments: { select: { amount: true } } } })
  const m = new Map(rows.map((r) => [r.id, { status: r.status, paid: r.payments.reduce((s, p) => s + Number(p.amount), 0) }]))
  return ids.map((id) => m.get(id)!)
}

/** Every journal entry that references a QA payment must not exist (the ledger must stay untouched). */
async function assertNoLedger(label: string) {
  const pays = await prisma.payment.findMany({ where: { retailer: { name: CUST } }, select: { id: true } })
  const sp = await prisma.supplierPayment.findMany({ where: { purchaseInvoice: { supplier: { name: SUPP } } }, select: { id: true } })
  const n = await prisma.journalEntry.count({ where: { sourceId: { in: [...pays, ...sp].map((p) => p.id) } } })
  check(`no journal entry for QA payments (${label})`, n === 0, `entries=${n}`)
  if (n > 0) throw new Error('Ledger entries were created: is the dev server running with PDC_TEST_SKIP_SYNC=1? Aborting.')
}

async function main() {
  // ---- guards ----
  const foreignR = await prisma.retailer.findMany({
    where: { name: { startsWith: 'QA ' }, NOT: { name: CUST }, OR: [{ invoices: { some: {} } }, { payments: { some: {} } }, { cheques: { some: {} } }] },
    select: { name: true },
  })
  const foreignS = await prisma.supplier.findMany({
    where: { name: { startsWith: 'QA ' }, NOT: { name: SUPP }, OR: [{ purchaseInvoices: { some: {} } }, { cheques: { some: {} } }] },
    select: { name: true },
  })
  if (foreignR.length || foreignS.length) {
    throw new Error(`Refusing to run: 'QA ...' records this script did not create exist: ${[...foreignR, ...foreignS].map((x) => x.name).join(', ')}`)
  }
  if ((await prisma.retailer.count({ where: { name: CUST } })) || (await prisma.supplier.count({ where: { name: SUPP } }))) {
    throw new Error('QA PDC residue from a previous run exists: remove it first')
  }
  const bank = await prisma.account.findFirst({ where: { type: 'ASSET', subType: 'BANK', isActive: true }, orderBy: { code: 'asc' } })
  if (!bank) throw new Error('No active bank account to clear into')
  const ping = await call('GET', '/api/cheques?page=1', ADMIN).catch(() => null)
  if (!ping || ping.status !== 200) throw new Error(`Dev server on ${BASE} not reachable / cheque API not answering`)
  const mode = await call('GET', '/api/cheques/qa-mode', ADMIN)
  if (mode.status !== 200 || mode.json?.skipSync !== true) {
    throw new Error(`Refusing to run: the dev server must be started with PDC_TEST_SKIP_SYNC=1 (qa-mode: ${mode.status} ${JSON.stringify(mode.json)})`)
  }
  check('preflight: dev server skips the ledger sync for clearing (PDC_TEST_SKIP_SYNC=1)', true)
  started = true

  // ---- data: one customer with three invoices (distinct dates, oldest first = I1), one supplier with one purchase invoice
  const cust = await prisma.retailer.create({ data: { name: CUST } })
  const mkInv = async (n: number, total: number, date: string) => {
    const order = await prisma.order.create({
      data: { retailerId: cust.id, orderNumber: `${TAG}-ORD-${Date.now()}-${n}`, status: 'CONFIRMED', totalAmount: total },
    })
    return prisma.invoice.create({
      data: {
        invoiceNumber: `${TAG}-INV-${Date.now()}-${n}`, orderId: order.id, retailerId: cust.id,
        invoiceDate: new Date(`${date}T10:00:00+05:00`), subtotal: total, totalAmount: total, status: 'UNPAID',
      },
    })
  }
  // created out of date order on purpose: allocation must follow invoiceDate, not creation order
  const I2 = await mkInv(2, 500, '2026-09-05')
  const I1 = await mkInv(1, 1000, '2026-09-01')
  const I3 = await mkInv(3, 300, '2026-09-10')
  const inv = [I1.id, I2.id, I3.id]
  const supp = await prisma.supplier.create({ data: { name: SUPP, type: 'OPEN_MARKET' } })
  const PI = await prisma.purchaseInvoice.create({
    data: { invoiceNumber: `${TAG}-PUR-${Date.now()}`, supplierId: supp.id, invoiceDate: new Date('2026-09-02T10:00:00+05:00'), totalAmount: 400, grandTotal: 400 },
  })
  const outstanding = async () => Number((await call('GET', `/api/retailers/${cust.id}`, ADMIN)).json?.data?.outstandingBalance)
  const out0 = await outstanding()
  check('setup: customer outstanding is 1800', out0 === 1800, String(out0))

  // ---- 1. pending cheque changes nothing ----
  const a = await newCheque(ADMIN, { retailerId: cust.id, chequeNumber: `${TAG}-A`, amount: '1200' })
  const A = a.json?.data
  check('admin creates a receivable cheque -> 201 PENDING, auto-acknowledged', a.status === 201 && A?.status === 'PENDING' && !!A?.acknowledgedAt, `${a.status} ${JSON.stringify(a.json).slice(0, 200)}`)
  const s1 = await invoiceState(inv)
  check('pending cheque: invoices still UNPAID, no payments', s1.every((s) => s.status === 'UNPAID' && s.paid === 0), JSON.stringify(s1))
  check('pending cheque: customer outstanding unchanged', (await outstanding()) === out0)
  check('pending cheque: no payment rows for the customer', (await prisma.payment.count({ where: { retailerId: cust.id } })) === 0)

  // ---- 2. clearing without a bank account -> 400 ----
  const nb = await status(A.id, ADMIN, 'clear', { clearingDate: today() })
  check('clear without bank account -> 400', nb.status === 400, `${nb.status} ${nb.json?.error}`)

  // ---- 3. two parallel clears -> one 200, one 409, payments created once; oldest-first split ----
  const [p1, p2] = await Promise.all([
    status(A.id, ADMIN, 'clear', { clearingDate: today(), bankAccountId: bank.id }),
    status(A.id, MANAGER, 'clear', { clearingDate: today(), bankAccountId: bank.id }),
  ])
  const codes = [p1.status, p2.status].sort().join(',')
  check('parallel clear -> exactly one 200 and one 409', codes === '200,409', `${codes} ${p1.json?.error ?? ''} ${p2.json?.error ?? ''}`)
  const payA = await prisma.payment.findMany({ where: { chequeId: A.id }, orderBy: { amount: 'desc' } })
  check('payments created once (2 rows for the 1200 cheque)', payA.length === 2, String(payA.length))
  check('clear pays oldest invoice first and splits (I1 1000 + I2 200)',
    payA.some((p) => p.invoiceId === I1.id && Number(p.amount) === 1000) && payA.some((p) => p.invoiceId === I2.id && Number(p.amount) === 200),
    JSON.stringify(payA.map((p) => [p.invoiceId === I1.id ? 'I1' : p.invoiceId === I2.id ? 'I2' : 'I3', Number(p.amount)])))
  check('cleared payments carry method CHEQUE, cheque # reference and the bank account',
    payA.every((p) => p.method === 'CHEQUE' && p.reference === `${TAG}-A` && p.bankAccountId === bank.id))
  const s3 = await invoiceState(inv)
  check('after clear: I1 PAID, I2 PARTIAL, I3 UNPAID', s3[0].status === 'PAID' && s3[1].status === 'PARTIAL' && s3[2].status === 'UNPAID', JSON.stringify(s3))
  check('after clear: outstanding dropped by exactly 1200', (await outstanding()) === 600)
  const aRow = await prisma.cheque.findUnique({ where: { id: A.id } })
  check('cheque is CLEARED with clearedAt and bank', aRow?.status === 'CLEARED' && !!aRow.clearedAt && aRow.bankAccountId === bank.id)
  await assertNoLedger('after first clear')

  // ---- 4. second cheque pays the next-oldest open invoice ----
  const b = await newCheque(ADMIN, { retailerId: cust.id, chequeNumber: `${TAG}-B`, amount: '300', bankAccountId: bank.id })
  const cb = await status(b.json.data.id, ADMIN, 'clear', { clearingDate: today() })
  const payB = await prisma.payment.findMany({ where: { chequeId: b.json.data.id } })
  check('second cheque (300) pays the rest of I2 (next oldest), not I3',
    cb.status === 200 && payB.length === 1 && payB[0].invoiceId === I2.id && Number(payB[0].amount) === 300, `${cb.status} ${cb.json?.error ?? ''}`)
  const s4 = await invoiceState(inv)
  check('I2 now PAID, I3 still UNPAID', s4[1].status === 'PAID' && s4[2].status === 'UNPAID', JSON.stringify(s4))

  // ---- 5. cheque bigger than all unpaid invoices -> 409, still pending, no payments ----
  const c = await newCheque(ADMIN, { retailerId: cust.id, chequeNumber: `${TAG}-C`, amount: '5000', bankAccountId: bank.id })
  const cc = await status(c.json.data.id, ADMIN, 'clear', { clearingDate: today() })
  const cRow = await prisma.cheque.findUnique({ where: { id: c.json.data.id } })
  check("cheque > unpaid invoices -> 409 'Cheque amount exceeds unpaid invoices'", cc.status === 409 && /exceeds unpaid invoices/i.test(cc.json?.error ?? ''), `${cc.status} ${cc.json?.error}`)
  check('over-amount cheque still PENDING with no payments', cRow?.status === 'PENDING' && (await prisma.payment.count({ where: { chequeId: c.json.data.id } })) === 0)

  // ---- 6. returned cheque cannot clear; returned -> represent -> clear works ----
  const d = await newCheque(ADMIN, { retailerId: cust.id, chequeNumber: `${TAG}-D`, amount: '100', bankAccountId: bank.id })
  const D = d.json.data
  const dr = await status(D.id, ADMIN, 'return')
  check('pending -> return -> RETURNED', dr.status === 200 && dr.json?.data?.status === 'RETURNED', `${dr.status}`)
  const dc = await status(D.id, ADMIN, 'clear', { clearingDate: today() })
  check('clear on a RETURNED cheque -> 409', dc.status === 409, `${dc.status} ${dc.json?.error}`)
  const drp = await status(D.id, ACCOUNTANT, 'represent')
  check('returned -> represent -> PENDING', drp.status === 200 && drp.json?.data?.status === 'PENDING', `${drp.status}`)
  const dc2 = await status(D.id, ACCOUNTANT, 'clear', { clearingDate: today() })
  const payD = await prisma.payment.findMany({ where: { chequeId: D.id } })
  check('re-presented cheque clears and pays I3 (100 of 300 -> PARTIAL)',
    dc2.status === 200 && payD.length === 1 && payD[0].invoiceId === I3.id && (await invoiceState([I3.id]))[0].status === 'PARTIAL', `${dc2.status} ${dc2.json?.error ?? ''}`)

  // ---- 7. a cleared cheque is final ----
  const st = await status(A.id, ADMIN, 'stop')
  const rt = await status(A.id, ADMIN, 'return')
  const rp = await status(A.id, ADMIN, 'represent')
  check('cleared cheque cannot be stopped / returned / re-presented (4xx)', [st, rt, rp].every((r) => r.status >= 400 && r.status < 500), [st, rt, rp].map((r) => r.status).join(','))
  const pa = await call('PATCH', `/api/cheques/${A.id}`, ADMIN, { amount: '999' })
  check('cleared cheque amount cannot be edited (4xx)', pa.status >= 400 && pa.status < 500, `${pa.status} ${pa.json?.error}`)
  const pd = await call('PATCH', `/api/cheques/${A.id}`, ADMIN, { chequeDate: today() })
  check('cleared cheque date cannot be edited (4xx)', pd.status >= 400 && pd.status < 500, `${pd.status}`)
  const pn = await call('PATCH', `/api/cheques/${A.id}`, MANAGER, { notes: 'QA PDC note' })
  check('cleared cheque notes can still be edited', pn.status === 200 && pn.json?.data?.notes === 'QA PDC note', `${pn.status}`)
  check('cleared cheque amount unchanged', Number((await prisma.cheque.findUnique({ where: { id: A.id } }))?.amount) === 1200)

  // ---- 8. roles ----
  const sp = await call('POST', '/api/cheques', SALESMAN, { direction: 'PAYABLE', supplierId: supp.id, chequeNumber: `${TAG}-SP`, amount: '10', chequeDate: today() })
  check('SALESMAN cannot create a PAYABLE cheque -> 403', sp.status === 403, `${sp.status}`)
  const e = await newCheque(SALESMAN, { retailerId: cust.id, chequeNumber: `${TAG}-E`, amount: '50' })
  const E = e.json?.data
  check('SALESMAN creates a receivable cheque -> 201, unacknowledged', e.status === 201 && !E?.acknowledgedAt, `${e.status} ${e.json?.error ?? ''}`)
  const sa = await status(E.id, SALESMAN, 'acknowledge')
  check('SALESMAN cannot acknowledge -> 403', sa.status === 403, `${sa.status}`)
  const sc = await status(E.id, SALESMAN, 'clear', { clearingDate: today(), bankAccountId: bank.id })
  check('SALESMAN cannot clear -> 403', sc.status === 403, `${sc.status}`)
  const sl = await call('GET', '/api/cheques?page=1', SALESMAN)
  check('SALESMAN list shows only own cheques', sl.status === 200 && sl.json.data.length >= 1 && sl.json.data.every((x: any) => x.recordedById === 'qa-pdc-salesman') && sl.json.data.some((x: any) => x.id === E.id), `${sl.status} n=${sl.json?.data?.length}`)
  const sl2 = await call('GET', '/api/cheques?page=1', SALESMAN2)
  check("another SALESMAN does not see that cheque", sl2.status === 200 && !sl2.json.data.some((x: any) => x.id === E.id))
  const sg = await call('GET', `/api/cheques/${E.id}`, SALESMAN2)
  check("another SALESMAN gets 404 on that cheque", sg.status === 404, `${sg.status}`)
  const sbank = await call('GET', '/api/cheques/banks', SALESMAN)
  check('SALESMAN cannot list bank accounts -> 403', sbank.status === 403, `${sbank.status}`)
  const mbank = await call('GET', '/api/cheques/banks', MANAGER)
  check('MANAGER can list bank accounts for clearing', mbank.status === 200 && mbank.json.data.some((x: any) => x.id === bank.id))

  // unacknowledged cheque cannot clear; ACCOUNTANT cannot acknowledge; MANAGER can
  const uc = await status(E.id, ADMIN, 'clear', { clearingDate: today(), bankAccountId: bank.id })
  check('unacknowledged cheque cannot clear -> 409', uc.status === 409 && /acknowledged/i.test(uc.json?.error ?? ''), `${uc.status} ${uc.json?.error}`)
  const aa = await status(E.id, ACCOUNTANT, 'acknowledge')
  check('ACCOUNTANT cannot acknowledge -> 403', aa.status === 403, `${aa.status}`)
  const ma = await status(E.id, MANAGER, 'acknowledge')
  check('MANAGER acknowledges -> 200', ma.status === 200 && !!ma.json?.data?.acknowledgedAt, `${ma.status}`)
  const se = await call('PATCH', `/api/cheques/${E.id}`, SALESMAN, { amount: '60' })
  check('SALESMAN cannot edit own cheque after acknowledgement -> 403', se.status === 403, `${se.status}`)
  const unackList = await call('GET', `/api/cheques?acknowledged=false&partyId=${cust.id}`, ADMIN)
  check('unacknowledged filter is empty for the customer now', unackList.status === 200 && unackList.json.total === 0, `${unackList.json?.total}`)
  const recvTotals = await call('GET', `/api/cheques?partyId=${cust.id}`, ADMIN)
  check('list totals: receivable sum of the customer cheques, payable 0',
    recvTotals.json?.totals?.receivable === 1200 + 300 + 5000 + 100 + 50 && recvTotals.json?.totals?.payable === 0, JSON.stringify(recvTotals.json?.totals))

  // ---- 8b. the same physical cheque cannot be recorded twice (unless explicitly allowed) ----
  const dup = await newCheque(ADMIN, { retailerId: cust.id, chequeNumber: ` ${TAG.toLowerCase()}-a `, amount: '10' })
  check('same number (other case/spaces) for the same customer -> 409 duplicate naming the cleared cheque',
    dup.status === 409 && dup.json?.duplicate === true && /already recorded for this customer \(status CLEARED\)/.test(dup.json?.error ?? ''), `${dup.status} ${dup.json?.error}`)
  const dupOk = await newCheque(ADMIN, { retailerId: cust.id, chequeNumber: `${TAG}-A`, amount: '10', allowDuplicate: true })
  check('allowDuplicate: true records it anyway -> 201', dupOk.status === 201, `${dupOk.status} ${dupOk.json?.error ?? ''}`)
  const pdup = await call('PATCH', `/api/cheques/${c.json.data.id}`, ADMIN, { chequeNumber: `${TAG}-B` })
  check('PATCH a cheque number onto an existing one -> 409 duplicate', pdup.status === 409 && pdup.json?.duplicate === true, `${pdup.status} ${pdup.json?.error}`)
  const pdupOk = await call('PATCH', `/api/cheques/${c.json.data.id}`, ADMIN, { chequeNumber: `${TAG}-B`, allowDuplicate: true })
  check('PATCH with allowDuplicate -> 200', pdupOk.status === 200, `${pdupOk.status} ${pdupOk.json?.error ?? ''}`)

  // ---- 8c. hard-deleting an order whose invoice was paid by a cleared cheque is refused ----
  const hd = await call('DELETE', `/api/orders/${I1.orderId}?hard=true`, ADMIN)
  const i1After = await prisma.invoice.findUnique({ where: { id: I1.id }, select: { id: true, payments: { select: { id: true } } } })
  check('hard delete of an order paid by a cleared cheque -> 409 naming the cheque, nothing deleted',
    hd.status === 409 && new RegExp(`cleared cheque ${TAG}-A`).test(hd.json?.error ?? '') && !!i1After && i1After.payments.length === 1, `${hd.status} ${hd.json?.error}`)

  // ---- 9. payment routes ----
  const before3 = await prisma.payment.count({ where: { invoiceId: I3.id } })
  const lc = await call('POST', `/api/invoices/${I3.id}/payments`, ADMIN, { amount: 20, method: 'cheque', reference: `${TAG}-LC`, paymentDate: today() })
  const lcRow = await prisma.cheque.findFirst({ where: { chequeNumber: `${TAG}-LC` } })
  check("payment route with method 'cheque' (lowercase) -> pending cheque, no payment",
    lc.status === 201 && lc.json?.pending === true && lcRow?.status === 'PENDING' && lcRow.retailerId === cust.id &&
    (await prisma.payment.count({ where: { invoiceId: I3.id } })) === before3, `${lc.status} ${JSON.stringify(lc.json).slice(0, 150)}`)
  const lcDup = await call('POST', `/api/invoices/${I3.id}/payments`, ADMIN, { amount: 20, method: 'CHEQUE', reference: `${TAG}-lc`, paymentDate: today() })
  check('payment route: same cheque number again -> 409 duplicate', lcDup.status === 409 && lcDup.json?.duplicate === true, `${lcDup.status} ${lcDup.json?.error}`)
  const lcDup2 = await call('POST', `/api/invoices/${I3.id}/payments`, ADMIN, { amount: 20, method: 'CHEQUE', reference: `${TAG}-LC`, paymentDate: '2026-11-01', allowDuplicate: true })
  const lc2 = lcDup2.json?.data?.cheque
  check('payment route passes allowDuplicate through and uses the payment Date as received date',
    lcDup2.status === 201 && !!lc2 && new Date(lc2.receivedDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) === '2026-11-01', `${lcDup2.status} ${lc2?.receivedDate}`)
  const tl = await call('POST', `/api/invoices/${I3.id}/payments`, cookie('TEAM_LEAD', 'qa-pdc-teamlead'), { amount: 20, method: 'CHEQUE', reference: `${TAG}-TL`, paymentDate: today() })
  check("TEAM_LEAD recording a cheque on the payment route -> 403 'Your role cannot record cheques'", tl.status === 403 && tl.json?.error === 'Your role cannot record cheques', `${tl.status} ${tl.json?.error}`)
  const banksDefault = await call('GET', '/api/cheques/banks', MANAGER)
  const banksAll = await call('GET', '/api/cheques/banks?includeInactive=1', MANAGER)
  check('banks endpoint returns only active banks by default; includeInactive=1 returns at least as many',
    banksDefault.status === 200 && banksDefault.json.data.every((x: any) => x.isActive) && banksAll.status === 200 && banksAll.json.data.length >= banksDefault.json.data.length)
  const cash = await call('POST', `/api/invoices/${I3.id}/payments`, ADMIN, { amount: 10, method: 'CASH', paymentDate: CASH_DATE })
  const s9 = (await invoiceState([I3.id]))[0]
  check('CASH payment route unchanged: payment created and invoice status recomputed',
    cash.status === 201 && cash.json?.data?.payment?.method === 'CASH' && cash.json?.data?.newStatus === 'PARTIAL' && s9.paid === 110, `${cash.status} paid=${s9.paid}`)

  // ---- 10. payable cheque clears against the purchase invoice ----
  const pc = await call('POST', '/api/cheques', ACCOUNTANT, { direction: 'PAYABLE', supplierId: supp.id, chequeNumber: `${TAG}-A`, amount: '400', chequeDate: today(), bankAccountId: bank.id })
  const pcc = await status(pc.json?.data?.id, ACCOUNTANT, 'clear', { clearingDate: today() })
  const spays = await prisma.supplierPayment.findMany({ where: { chequeId: pc.json?.data?.id } })
  const piRow = await prisma.purchaseInvoice.findUnique({ where: { id: PI.id } })
  check('payable cheque with the number of a receivable cheque (other direction/party) is not a duplicate; it clears: one supplier payment, purchase invoice PAID',
    pc.status === 201 && pcc.status === 200 && spays.length === 1 && Number(spays[0].amount) === 400 && piRow?.status === 'PAID', `${pc.status} ${pcc.status} ${pcc.json?.error ?? ''}`)

  // ---- 11. audit ----
  const audit = async (recordId: string) => prisma.auditLog.findMany({ where: { model: 'Cheque', recordId }, orderBy: { createdAt: 'asc' } })
  const eA = await audit(E.id)
  check('audit: cheque CREATE row with the salesman as actor', eA.some((x) => x.action === 'CREATE' && x.actorId === 'qa-pdc-salesman'), eA.map((x) => x.action).join(','))
  check('audit: acknowledge logged as UPDATE of acknowledgedAt by the manager', eA.some((x) => x.action === 'UPDATE' && x.actorId === 'qa-pdc-manager' && !!(x.changes as any)?.acknowledgedAt))
  const aA = await audit(A.id)
  check('audit: clear logged as UPDATE status -> CLEARED', aA.some((x) => x.action === 'UPDATE' && (x.changes as any)?.status?.to === 'CLEARED'), aA.map((x) => JSON.stringify(x.changes)).join(' | ').slice(0, 300))
  const payAudit = await prisma.auditLog.count({ where: { model: 'Payment', action: 'CREATE', recordId: { in: payA.map((p) => p.id) } } })
  check('audit: payment CREATE rows for the cleared cheque', payAudit === payA.length, `${payAudit}/${payA.length}`)

  await assertNoLedger('end')
}

async function cleanup() {
  if (!started) return
  const custs = (await prisma.retailer.findMany({ where: { name: CUST }, select: { id: true } })).map((r) => r.id)
  const supps = (await prisma.supplier.findMany({ where: { name: SUPP }, select: { id: true } })).map((s) => s.id)
  const cheques = (await prisma.cheque.findMany({ where: { OR: [{ retailerId: { in: custs } }, { supplierId: { in: supps } }, { chequeNumber: { startsWith: TAG } }] }, select: { id: true } })).map((c) => c.id)
  const pays = (await prisma.payment.findMany({ where: { OR: [{ retailerId: { in: custs } }, { chequeId: { in: cheques } }] }, select: { id: true } })).map((p) => p.id)
  const spays = (await prisma.supplierPayment.findMany({ where: { OR: [{ supplierId: { in: supps } }, { chequeId: { in: cheques } }] }, select: { id: true } })).map((p) => p.id)
  const invs = (await prisma.invoice.findMany({ where: { retailerId: { in: custs } }, select: { id: true } })).map((i) => i.id)
  const orders = (await prisma.order.findMany({ where: { retailerId: { in: custs } }, select: { id: true } })).map((o) => o.id)
  const pis = (await prisma.purchaseInvoice.findMany({ where: { supplierId: { in: supps } }, select: { id: true } })).map((p) => p.id)
  const ids = new Set([...custs, ...supps, ...cheques, ...pays, ...spays, ...invs, ...orders, ...pis])

  await prisma.payment.deleteMany({ where: { id: { in: pays } } })
  await prisma.supplierPayment.deleteMany({ where: { id: { in: spays } } })
  await prisma.cheque.deleteMany({ where: { id: { in: cheques } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs } } })
  await prisma.order.deleteMany({ where: { id: { in: orders } } })
  await prisma.purchaseInvoice.deleteMany({ where: { id: { in: pis } } })
  await prisma.retailer.deleteMany({ where: { id: { in: custs } } })
  await prisma.supplier.deleteMany({ where: { id: { in: supps } } })

  // Should never happen (assertNoLedger aborts): if a QA source was posted, re-sync it now that it is gone.
  const jes = await prisma.journalEntry.findMany({ where: { sourceId: { in: Array.from(ids) } }, select: { sourceType: true, sourceId: true } })
  if (jes.length) {
    const { syncAllSafe } = await import('../../lib/accounting/sync')
    await syncAllSafe(jes.map((x) => [x.sourceType as any, x.sourceId]))
  }

  const ours = (x: { recordId: string | null; changes: unknown; actorId: string | null }) => {
    if (x.recordId && ids.has(x.recordId)) return true
    if (x.actorId?.startsWith('qa-pdc-')) return true
    const text = JSON.stringify(x.changes ?? null)
    return text.includes('QA PDC') || text.includes(TAG) || Array.from(ids).some((id) => text.includes(id))
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

  const left =
    (await prisma.retailer.count({ where: { name: CUST } })) +
    (await prisma.supplier.count({ where: { name: SUPP } })) +
    (await prisma.cheque.count({ where: { OR: [{ id: { in: cheques } }, { chequeNumber: { startsWith: TAG } }] } })) +
    (await prisma.payment.count({ where: { id: { in: pays } } })) +
    (await prisma.supplierPayment.count({ where: { id: { in: spays } } })) +
    (await prisma.invoice.count({ where: { OR: [{ id: { in: invs } }, { invoiceNumber: { startsWith: TAG } }] } })) +
    (await prisma.order.count({ where: { OR: [{ id: { in: orders } }, { orderNumber: { startsWith: TAG } }] } })) +
    (await prisma.purchaseInvoice.count({ where: { OR: [{ id: { in: pis } }, { invoiceNumber: { startsWith: TAG } }] } })) +
    (await prisma.journalEntry.count({ where: { sourceId: { in: Array.from(ids) } } })) +
    (await mineOf()).length
  console.log(`Leftover QA rows: ${left}`)
  if (left !== 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { try { await cleanup() } catch (e) { console.error('CLEANUP FAILED', e); process.exitCode = 1 } await prisma.$disconnect() })
