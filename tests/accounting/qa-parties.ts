/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA for Accounts Receivable / Payable APIs and pages. PRODUCTION DB — QA-prefixed records only.
// Needs a dev server on :3100 (npx next dev -p 3100). Run: npx tsx tests/accounting/qa-parties.ts
import { prisma, BASE, staffCookie, api, check } from '../portal/qa-helpers'

const ADMIN = staffCookie('ADMIN')
const ACCT = staffCookie('ACCOUNTANT')
const QA_CUSTOMER = 'QA Parties Customer'
const QA_SUPPLIER = 'QA Parties Supplier'

async function json(res: Response) { try { return await res.json() } catch { return null } }
const ids = { orders: [] as string[], invoices: [] as string[], payments: [] as string[], purchaseInvoices: [] as string[], supplierPayments: [] as string[] }

async function cleanup(orig: { goLiveDate: Date | null; lockedThrough: Date | null; defaultBankAccountId: string | null } | null, n0: number) {
  await prisma.accountingSettings.updateMany({ data: { goLiveDate: orig?.goLiveDate ?? null, lockedThrough: orig?.lockedThrough ?? null, defaultBankAccountId: orig?.defaultBankAccountId ?? null } })
  const rid = (await prisma.retailer.findMany({ where: { name: QA_CUSTOMER }, select: { id: true } })).map((r) => r.id)
  const sid = (await prisma.supplier.findMany({ where: { name: QA_SUPPLIER }, select: { id: true } })).map((r) => r.id)
  const orders = (await prisma.order.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const invs = (await prisma.invoice.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const pays = (await prisma.payment.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const pis = (await prisma.purchaseInvoice.findMany({ where: { supplierId: { in: sid } }, select: { id: true } })).map((o) => o.id)
  const sps = (await prisma.supplierPayment.findMany({ where: { supplierId: { in: sid } }, select: { id: true } })).map((o) => o.id)
  const everything = [...ids.orders, ...ids.invoices, ...ids.payments, ...ids.purchaseInvoices, ...ids.supplierPayments, ...orders, ...invs, ...pays, ...pis, ...sps]
  await prisma.journalEntry.deleteMany({ where: { OR: [{ sourceId: { in: everything } }, { createdById: 'qa', isManual: true }] } })
  await prisma.supplierPayment.deleteMany({ where: { id: { in: sps } } })
  await prisma.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: { in: pis } } })
  await prisma.purchaseInvoice.deleteMany({ where: { id: { in: pis } } })
  await prisma.payment.deleteMany({ where: { id: { in: pays } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs } } })
  await prisma.deliveryChallan.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.delivery.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.order.deleteMany({ where: { id: { in: orders } } })
  await prisma.medicineBatch.deleteMany({ where: { medicine: { code: { startsWith: 'QAP' } } } })
  await prisma.medicine.deleteMany({ where: { code: { startsWith: 'QAP' } } })
  await prisma.retailer.deleteMany({ where: { id: { in: rid } } })
  await prisma.supplier.deleteMany({ where: { id: { in: sid } } })
  const n1 = await prisma.journalEntry.count()
  check('cleanup: journal entry count restored', n1 === n0, `(${n1} vs ${n0})`)
  const left = (await prisma.retailer.count({ where: { name: QA_CUSTOMER } })) + (await prisma.supplier.count({ where: { name: QA_SUPPLIER } })) + (await prisma.medicine.count({ where: { code: { startsWith: 'QAP' } } }))
  check('cleanup: no QA residue', left === 0)
  const s = await prisma.accountingSettings.findFirst()
  check('cleanup: settings restored', (s?.goLiveDate?.getTime() ?? null) === (orig?.goLiveDate?.getTime() ?? null) && (s?.lockedThrough?.getTime() ?? null) === (orig?.lockedThrough?.getTime() ?? null) && (s?.defaultBankAccountId ?? null) === (orig?.defaultBankAccountId ?? null))
}

async function main() {
  const n0 = await prisma.journalEntry.count()
  if (n0 !== 0) throw new Error(`Refusing to run: ${n0} journal entries already exist (expected none before go-live)`)
  if (await prisma.retailer.count({ where: { name: QA_CUSTOMER } })) throw new Error('QA residue from a previous run exists')

  const settings0 = await prisma.accountingSettings.findFirst()
  const orig = settings0 ? { goLiveDate: settings0.goLiveDate, lockedThrough: settings0.lockedThrough, defaultBankAccountId: settings0.defaultBankAccountId } : null
  try {
    // ---- roles ----
    {
      const routes: [string, string][] = [
        ['GET', '/api/accounts/receivable'], ['GET', '/api/accounts/receivable/x'], ['POST', '/api/accounts/receivable/opening-balance'],
        ['GET', '/api/accounts/payable'], ['GET', '/api/accounts/payable/x'], ['POST', '/api/accounts/payable/opening-balance'],
      ]
      let bad = 0
      for (const [method, path] of routes) {
        for (const [who, cookie] of [['MANAGER', staffCookie('MANAGER')], ['SALES_REP', staffCookie('SALES_REP')], ['TEAM_LEAD', staffCookie('TEAM_LEAD')]] as const) {
          const r = await fetch(`${BASE}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })
          if (r.status !== 403) { bad++; console.log('  expected 403', who, method, path, '->', r.status) }
        }
        const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })
        if (r.status !== 401) { bad++; console.log('  expected 401 no cookie', method, path, '->', r.status) }
      }
      check('403/401 on every receivable/payable route for non-accounts roles', bad === 0)
    }

    // ---- fixtures ----
    const mfr = await prisma.manufacturer.findFirst({ select: { id: true } })
    const retailer = await prisma.retailer.create({ data: { name: QA_CUSTOMER } })
    const supplier = await prisma.supplier.create({ data: { name: QA_SUPPLIER, type: 'OPEN_MARKET' } })
    const code = `QAP${Math.floor(Math.random() * 900000 + 100000)}`
    const med = await prisma.medicine.create({ data: { code, name: `QA PARTIES ITEM ${code}`, manufacturerId: mfr!.id } })
    await prisma.medicineBatch.create({ data: { medicineId: med.id, batchNumber: 'QAP-B1', expiryDate: new Date('2030-06-01'), quantityIn: 1000, currentQty: 1000, purchasePrice: 60, tradePrice: 100, mrp: 130 } })

    const goDay = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
    const goLive = new Date(`${goDay}T00:00:00+05:00`)

    // ---- validation + go-live gating ----
    let r = await api('/api/accounts/receivable/opening-balance', ACCT, { method: 'POST', body: JSON.stringify({ partyId: retailer.id, amount: 1000 }) })
    check('opening balance without go-live -> 409', r.status === 409)
    r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ goLiveDate: goLive.toISOString() }) })
    check('settings: set go-live', r.status === 200)
    r = await api('/api/accounts/receivable/opening-balance', ACCT, { method: 'POST', body: JSON.stringify({ partyId: retailer.id, amount: 0 }) })
    check('opening balance amount 0 -> 400', r.status === 400)
    r = await api('/api/accounts/receivable/opening-balance', ACCT, { method: 'POST', body: JSON.stringify({ partyId: retailer.id, amount: -5 }) })
    check('opening balance negative -> 400', r.status === 400)
    r = await api('/api/accounts/receivable/opening-balance', ACCT, { method: 'POST', body: JSON.stringify({ partyId: 'nope', amount: 5 }) })
    check('opening balance unknown party -> 400', r.status === 400)
    r = await api('/api/accounts/receivable/opening-balance', ACCT, { method: 'POST', body: JSON.stringify({ amount: 5 }) })
    check('opening balance missing party -> 400', r.status === 400)
    r = await api('/api/accounts/receivable/opening-balance', ACCT, { method: 'POST', body: JSON.stringify({ partyId: retailer.id, amount: 2e9 }) })
    check('opening balance above 1e9 -> 400', r.status === 400)
    check('failed attempts posted nothing', (await prisma.journalEntry.count()) === 0)
    r = await api('/api/accounts/receivable/x?from=2026-02-31', ACCT)
    check('statement: invalid from -> 400', r.status === 400)
    r = await api('/api/accounts/receivable/nope', ACCT)
    check('statement: unknown customer -> 404', r.status === 404)

    // ---- AR: opening balance + invoice + payment ----
    r = await api('/api/accounts/receivable/opening-balance', ACCT, { method: 'POST', body: JSON.stringify({ partyId: retailer.id, amount: 1000 }) })
    const ob = (await json(r))?.data
    check('AR opening balance: 201', r.status === 201 && !!ob)
    const obLines = await prisma.journalLine.findMany({ where: { entryId: ob.id }, include: { account: true } })
    const arL = obLines.find((l) => l.account.systemKey === 'AR')
    const eqL = obLines.find((l) => l.account.systemKey === 'OPENING_EQUITY')
    check('AR opening: Dr AR[party] 1000 / Cr Opening Equity 1000, manual, dated go-live',
      Number(arL?.debit) === 1000 && arL?.retailerId === retailer.id && Number(eqL?.credit) === 1000 && ob.isManual === true && ob.memo === 'Opening balance' && new Date(ob.date).getTime() === goLive.getTime())

    r = await api('/api/accounts/receivable/opening-balance', ACCT, { method: 'POST', body: JSON.stringify({ partyId: retailer.id, amount: 1000 }) })
    check('AR opening balance double submit (sequential) -> 409, still one entry', r.status === 409 && /already exists/i.test((await json(r))?.error ?? '') && (await prisma.journalEntry.count({ where: { isManual: true, memo: 'Opening balance', lines: { some: { retailerId: retailer.id } } } })) === 1)

    const mk = await api('/api/orders', ADMIN, { method: 'POST', body: JSON.stringify({ retailerId: retailer.id, items: [{ medicineId: med.id, quantity: 10, unitPrice: 100, offerPercent: 10, salesTax: 0 }] }) })
    const order = (await json(mk)).data
    ids.orders.push(order.id)
    await api(`/api/orders/${order.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'CONFIRMED' }) })
    const inv = await prisma.invoice.findUnique({ where: { orderId: order.id } })
    ids.invoices.push(inv!.id)
    const invTotal = Number(inv!.totalAmount)
    check('invoice 900 posted by hook', invTotal === 900, String(invTotal))

    r = await api(`/api/accounts/receivable/${retailer.id}`, ACCT)
    let st = (await json(r))?.data
    check('statement: 2 rows, running balance 1000 then 1900', r.status === 200 && st.rows.length === 2 && st.rows[0].balance === 1000 && st.rows[1].balance === 1900 && st.closing === 1900 && st.opening === 0, JSON.stringify(st?.rows?.map((x: any) => x.balance)))
    check('statement: reconciliation ledger 1900 vs invoices 900 -> difference == opening balance 1000', st.ledgerBalance === 1900 && st.invoiceBalance === 900 && st.difference === 1000)

    r = await api(`/api/invoices/${inv!.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 300, method: 'CASH' }) })
    const pay = (await json(r)).data.payment
    ids.payments.push(pay.id)
    r = await api(`/api/accounts/receivable/${retailer.id}`, ACCT)
    st = (await json(r)).data
    r = await api(`/api/retailers/${retailer.id}`, ADMIN)
    const rd = (await json(r))?.data
    check('customer outstandingBalance nets the payment on a PARTIAL invoice (900 - 300 = 600)', r.status === 200 && rd.outstandingBalance === 600, JSON.stringify({ ob: rd?.outstandingBalance, status: inv && (await prisma.invoice.findUnique({ where: { id: inv.id } }))?.status }))
    check('after payment 300: running 1000/1900/1600, difference still 1000', st.rows.length === 3 && st.rows[2].balance === 1600 && st.ledgerBalance === 1600 && st.invoiceBalance === 600 && st.difference === 1000, JSON.stringify({ l: st.ledgerBalance, i: st.invoiceBalance }))
    r = await api(`/api/accounts/receivable/${retailer.id}?from=2099-01-01`, ACCT)
    st = (await json(r)).data
    check('statement: opening before range = 1600, no rows', st.opening === 1600 && st.rows.length === 0 && st.closing === 1600)

    r = await api('/api/accounts/receivable?search=QA%20Parties&nonZero=1', ACCT)
    let lj = await json(r)
    const row = lj?.data?.find((p: any) => p.id === retailer.id)
    check('AR list: party row ledger 1600 / invoice 600 / difference 1000', r.status === 200 && lj.data.length === 1 && row.ledger === 1600 && row.invoice === 600 && row.difference === 1000, JSON.stringify(lj?.data))
    check('AR list: meta has totals + goLiveDate', typeof lj.meta.totals.ledger === 'number' && lj.meta.totals.differingParties >= 1 && !!lj.meta.goLiveDate && lj.meta.total === 1)
    r = await api('/api/accounts/receivable?search=zzz-no-such-party', ACCT)
    check('AR list: search with no match -> empty', (await json(r)).data.length === 0)
    r = await api('/api/accounts/receivable?diff=1&search=QA%20Parties', ACCT)
    check('AR list: diff=1 includes the differing party', (await json(r)).data.length === 1)
    r = await api('/api/accounts/receivable?limit=1&offset=0', ACCT)
    lj = await json(r)
    check('AR list: limit/offset paginate with total count', r.status === 200 && lj.data.length === 1 && lj.meta.limit === 1 && lj.meta.total >= 1)

    // a party with zero ledger but zero invoices disappears with nonZero; shows without it
    const idle = await prisma.retailer.create({ data: { name: QA_CUSTOMER } }) // second QA row, never posted
    r = await api('/api/accounts/receivable?search=QA%20Parties&nonZero=1', ACCT)
    check('AR list: nonZero hides party with no balance', (await json(r)).data.length === 1)
    await prisma.retailer.delete({ where: { id: idle.id } })

    // ---- AP ----
    const apBody = JSON.stringify({ partyId: supplier.id, amount: 250 })
    const apRes = await Promise.all([api('/api/accounts/payable/opening-balance', ACCT, { method: 'POST', body: apBody }), api('/api/accounts/payable/opening-balance', ACCT, { method: 'POST', body: apBody })])
    check('AP opening balance concurrent double submit: exactly one 201 and one 409', apRes.map((x) => x.status).sort().join() === '201,409', apRes.map((x) => x.status).join())
    r = apRes.find((x) => x.status === 201)!
    const apOb = (await json(r))?.data
    check('AP opening balance: 201, exactly one entry', r.status === 201 && !!apOb && (await prisma.journalEntry.count({ where: { isManual: true, memo: 'Opening balance', lines: { some: { supplierId: supplier.id } } } })) === 1)
    const apLines = await prisma.journalLine.findMany({ where: { entryId: apOb.id }, include: { account: true } })
    const apL = apLines.find((l) => l.account.systemKey === 'AP')
    const apEq = apLines.find((l) => l.account.systemKey === 'OPENING_EQUITY')
    check('AP opening: Dr Opening Equity 250 / Cr AP[supplier] 250', Number(apL?.credit) === 250 && apL?.supplierId === supplier.id && Number(apEq?.debit) === 250)
    r = await api('/api/purchase-invoices', ADMIN, { method: 'POST', body: JSON.stringify({ supplierId: supplier.id, items: [{ medicineId: med.id, batchNumber: 'QAP-B2', expiryDate: '2031-01-01', quantity: 10, bonusQuantity: 0, tradePrice: 50, mrp: 70 }] }) })
    const pi = (await json(r)).data
    ids.purchaseInvoices.push(pi.id)
    r = await api(`/api/purchase-invoices/${pi.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 200, method: 'CASH' }) })
    const sp = (await json(r)).data
    ids.supplierPayments.push(sp.id)
    r = await api(`/api/accounts/payable/${supplier.id}`, ACCT)
    st = (await json(r))?.data
    check('AP statement: credit-normal running balance 250, 750, 550', r.status === 200 && st.normal === 'CREDIT' && st.rows.length === 3 && st.rows[0].balance === 250 && st.rows[1].balance === 750 && st.rows[2].balance === 550, JSON.stringify(st?.rows?.map((x: any) => x.balance)))
    check('AP reconciliation: ledger 550 vs invoices 300 -> difference == opening 250', st.ledgerBalance === 550 && st.invoiceBalance === 300 && st.difference === 250, JSON.stringify({ l: st.ledgerBalance, i: st.invoiceBalance }))
    r = await api('/api/accounts/payable?search=QA%20Parties&nonZero=1', ACCT)
    lj = await json(r)
    check('AP list: row ledger 550 / invoice 300 / difference 250', r.status === 200 && lj.data.length === 1 && lj.data[0].ledger === 550 && lj.data[0].invoice === 300 && lj.data[0].difference === 250)

    // ---- locked period blocks opening balance ----
    await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ lockedThrough: goLive.toISOString() }) })
    r = await api('/api/accounts/receivable/opening-balance', ACCT, { method: 'POST', body: JSON.stringify({ partyId: retailer.id, amount: 5 }) })
    check('opening balance in locked period -> 409', r.status === 409)
    await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ lockedThrough: null }) })

    // trial balance
    const tb = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
    check('trial balance: total debits == total credits', Math.round(Number(tb._sum.debit) * 100) === Math.round(Number(tb._sum.credit) * 100))

    // ---- pages ----
    for (const p of ['/accounts/receivable', '/accounts/payable']) {
      const anon = await fetch(`${BASE}${p}`, { redirect: 'manual' })
      check(`${p} anonymous -> redirect/401`, anon.status === 307 || anon.status === 401, `status ${anon.status}`)
      const ok = await fetch(`${BASE}${p}`, { redirect: 'manual', headers: { cookie: ADMIN } })
      const html = await ok.text()
      check(`${p} ADMIN -> 200, not Coming Soon`, ok.status === 200 && !/Coming soon/i.test(html), `status ${ok.status}`)
    }
  } finally {
    await cleanup(orig, n0)
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
