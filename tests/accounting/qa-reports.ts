/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA for Tax Management + Financial Reporting + P&L. PRODUCTION DB — QA-prefixed records only.
// Needs a dev server on :3100 (npx next dev -p 3100). Run: npx tsx tests/accounting/qa-reports.ts
import { prisma, BASE, staffCookie, api, check } from '../portal/qa-helpers'

const ADMIN = staffCookie('ADMIN')
const ACCT = staffCookie('ACCOUNTANT')
const MGR = staffCookie('MANAGER')
const QA_CUSTOMER = 'QA Report Customer'
const QA_SUPPLIER = 'QA Report Supplier'
const QA_ASSET = 'QA Report Asset'

async function json(res: Response) { try { return await res.json() } catch { return null } }
const post = (path: string, body: any, cookie = ACCT) => api(path, cookie, { method: 'POST', body: JSON.stringify(body) })
const paisa = (n: any) => Math.round(Number(n) * 100)

const kNow = new Date(Date.now() + 5 * 3600_000)
const goDay = kNow.toISOString().slice(0, 10)
const monthKey = goDay.slice(0, 7)
const firstDay = `${monthKey}-01`
const lastDay = (() => { const [y, m] = monthKey.split('-').map(Number); return `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` })()
const goLive = new Date(`${firstDay}T00:00:00+05:00`)

const ids = { orders: [] as string[], invoices: [] as string[], payments: [] as string[], salesReturns: [] as string[], purchaseInvoices: [] as string[], supplierPayments: [] as string[], assets: [] as string[] }

async function cleanup(orig: { goLiveDate: Date | null; lockedThrough: Date | null; defaultBankAccountId: string | null } | null, n0: number) {
  await prisma.accountingSettings.updateMany({ data: { goLiveDate: orig?.goLiveDate ?? null, lockedThrough: orig?.lockedThrough ?? null, defaultBankAccountId: orig?.defaultBankAccountId ?? null } })
  const rid = (await prisma.retailer.findMany({ where: { name: QA_CUSTOMER }, select: { id: true } })).map((r) => r.id)
  const sid = (await prisma.supplier.findMany({ where: { name: QA_SUPPLIER }, select: { id: true } })).map((r) => r.id)
  const orders = (await prisma.order.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const invs = (await prisma.invoice.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const pays = (await prisma.payment.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const srs = (await prisma.salesReturn.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const pis = (await prisma.purchaseInvoice.findMany({ where: { supplierId: { in: sid } }, select: { id: true } })).map((o) => o.id)
  const sps = (await prisma.supplierPayment.findMany({ where: { supplierId: { in: sid } }, select: { id: true } })).map((o) => o.id)
  const assets = (await prisma.fixedAsset.findMany({ where: { name: QA_ASSET }, select: { id: true } })).map((a) => a.id)
  const everything = [...ids.orders, ...ids.invoices, ...ids.payments, ...ids.salesReturns, ...ids.purchaseInvoices, ...ids.supplierPayments, ...orders, ...invs, ...pays, ...srs, ...pis, ...sps]
  const allAssets = Array.from(new Set([...ids.assets, ...assets]))
  await prisma.journalEntry.deleteMany({
    where: { OR: [
      { sourceId: { in: [...everything, ...allAssets] } },
      ...allAssets.map((i) => ({ sourceId: { startsWith: `${i}:` } })),
      { sourceType: 'MANUAL_CASH', sourceId: { startsWith: 'req:qa-rep' } },
    ] },
  })
  await prisma.fixedAsset.deleteMany({ where: { id: { in: allAssets } } })
  await prisma.salesReturnItem.deleteMany({ where: { salesReturnId: { in: srs } } })
  await prisma.salesReturn.deleteMany({ where: { id: { in: srs } } })
  await prisma.supplierPayment.deleteMany({ where: { id: { in: sps } } })
  await prisma.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: { in: pis } } })
  await prisma.purchaseInvoice.deleteMany({ where: { id: { in: pis } } })
  await prisma.payment.deleteMany({ where: { id: { in: pays } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs } } })
  await prisma.deliveryChallan.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.delivery.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.order.deleteMany({ where: { id: { in: orders } } })
  await prisma.medicineBatch.deleteMany({ where: { medicine: { code: { startsWith: 'QAR' } } } })
  await prisma.medicine.deleteMany({ where: { code: { startsWith: 'QAR' } } })
  await prisma.retailer.deleteMany({ where: { id: { in: rid } } })
  await prisma.supplier.deleteMany({ where: { id: { in: sid } } })
  const n1 = await prisma.journalEntry.count()
  check('cleanup: journal entry count restored', n1 === n0, `(${n1} vs ${n0})`)
  const left = (await prisma.retailer.count({ where: { name: QA_CUSTOMER } })) + (await prisma.supplier.count({ where: { name: QA_SUPPLIER } })) +
    (await prisma.medicine.count({ where: { code: { startsWith: 'QAR' } } })) + (await prisma.fixedAsset.count({ where: { name: QA_ASSET } }))
  check('cleanup: no QA residue', left === 0)
  const s = await prisma.accountingSettings.findFirst()
  check('cleanup: settings restored', (s?.goLiveDate?.getTime() ?? null) === (orig?.goLiveDate?.getTime() ?? null) && (s?.lockedThrough?.getTime() ?? null) === (orig?.lockedThrough?.getTime() ?? null) && (s?.defaultBankAccountId ?? null) === (orig?.defaultBankAccountId ?? null))
}

async function main() {
  const n0 = await prisma.journalEntry.count()
  if (n0 !== 0) throw new Error(`Refusing to run: ${n0} journal entries already exist (expected none before go-live)`)
  if ((await prisma.fixedAsset.count()) !== 0) throw new Error('Refusing to run: fixed assets already exist')
  if ((await prisma.retailer.count({ where: { name: QA_CUSTOMER } })) || (await prisma.supplier.count({ where: { name: QA_SUPPLIER } }))) throw new Error('QA residue from a previous run exists')

  const settings0 = await prisma.accountingSettings.findFirst()
  const orig = settings0 ? { goLiveDate: settings0.goLiveDate, lockedThrough: settings0.lockedThrough, defaultBankAccountId: settings0.defaultBankAccountId } : null
  try {
    // ---- auth ----
    const reportPaths = [
      '/api/accounts/tax', '/api/accounts/reports/trial-balance', '/api/accounts/reports/profit-loss', '/api/accounts/reports/balance-sheet',
    ]
    {
      let bad = 0
      for (const p of reportPaths) {
        const m = await fetch(`${BASE}${p}`, { headers: { cookie: MGR } })
        if (m.status !== 403) { bad++; console.log('  MANAGER expected 403', p, m.status) }
        const a = await fetch(`${BASE}${p}`)
        if (a.status !== 401) { bad++; console.log('  anon expected 401', p, a.status) }
        const ok = await api(p, ACCT)
        if (ok.status !== 200) { bad++; console.log('  ACCOUNTANT expected 200', p, ok.status) }
      }
      check('accounts report APIs: 403 MANAGER, 401 anon, 200 ACCOUNTANT', bad === 0)
      const w1 = await api('/api/reports/profit-loss', MGR)
      const w2 = await api('/api/reports/profit-loss', staffCookie('SALES_REP'))
      const w3 = await fetch(`${BASE}/api/reports/profit-loss`)
      check('P&L wrapper: MANAGER 200, SALES_REP 403, anon 401', w1.status === 200 && w2.status === 403 && w3.status === 401, `${w1.status},${w2.status},${w3.status}`)
    }

    // ---- validation ----
    {
      let bad = 0
      for (const q of ['/api/accounts/reports/trial-balance?asOf=garbage', '/api/accounts/reports/balance-sheet?asOf=2026-02-31', '/api/accounts/reports/profit-loss?from=x', '/api/accounts/reports/profit-loss?from=2026-05-02&to=2026-05-01', '/api/accounts/tax?to=2026-13-01', '/api/reports/profit-loss?from=bad']) {
        const r = await api(q, ADMIN)
        if (r.status !== 400) { bad++; console.log('  expected 400', q, r.status) }
      }
      check('invalid dates -> 400 everywhere', bad === 0)
    }

    // ---- no go-live: zeros + flag ----
    if (!orig?.goLiveDate) {
      const r = await api('/api/accounts/reports/profit-loss', ACCT)
      const j = await json(r)
      const t = await json(await api('/api/accounts/tax', ACCT))
      check('no go-live: P&L zeros with goLiveDate null flag, tax empty', r.status === 200 && j.meta.goLiveDate === null && j.data.netProfit === 0 && t.meta.goLiveDate === null && t.data.months.length === 0)
    } else console.log('SKIP no-go-live check: go-live already set in production')

    // ---- fixtures ----
    const mfr = await prisma.manufacturer.findFirst({ select: { id: true } })
    const retailer = await prisma.retailer.create({ data: { name: QA_CUSTOMER } })
    const supplier = await prisma.supplier.create({ data: { name: QA_SUPPLIER, type: 'OPEN_MARKET', isFiler: true, ntnNumber: 'QA-1', strnStatus: 'UNREGISTERED' } })
    const code = `QAR${Math.floor(Math.random() * 900000 + 100000)}`
    const med = await prisma.medicine.create({ data: { code, name: `QA REPORT ITEM ${code}`, manufacturerId: mfr!.id, salesTaxApplicable: true } })
    const batch = await prisma.medicineBatch.create({
      data: { medicineId: med.id, batchNumber: 'QAR-B1', expiryDate: new Date('2030-06-01'), quantityIn: 1000, currentQty: 1000, purchasePrice: 60, tradePrice: 100, mrp: 130 },
    })

    let r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ goLiveDate: goLive.toISOString() }) })
    check('settings: go-live = first of this month', r.status === 200)

    // ---- scenario ----
    r = await api('/api/orders', ADMIN, { method: 'POST', body: JSON.stringify({ retailerId: retailer.id, items: [{ medicineId: med.id, quantity: 10, unitPrice: 100, offerPercent: 10, salesTax: 5 }] }) })
    const order = (await json(r)).data
    ids.orders.push(order.id)
    for (const status of ['CONFIRMED', 'PICKING', 'DELIVERED']) await api(`/api/orders/${order.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status }) })
    const inv = await prisma.invoice.findUnique({ where: { orderId: order.id } })
    ids.invoices.push(inv!.id)
    check('scenario: invoice has tax 50 and subtotal 900', Number(inv!.taxAmount) === 50 && Number(inv!.subtotal) === 900, `${inv!.taxAmount}/${inv!.subtotal}`)
    r = await api(`/api/invoices/${inv!.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 300, method: 'CASH' }) })
    ids.payments.push((await json(r)).data.payment.id)
    r = await api('/api/sales-returns', ADMIN, { method: 'POST', body: JSON.stringify({ retailerId: retailer.id, items: [{ medicineId: med.id, batchId: batch.id, quantity: 2, unitPrice: 90, restocked: true }] }) })
    const sret = (await json(r)).data
    ids.salesReturns.push(sret.id)
    r = await api('/api/purchase-invoices', ADMIN, { method: 'POST', body: JSON.stringify({ supplierId: supplier.id, items: [{ medicineId: med.id, batchNumber: 'QAR-B2', expiryDate: '2031-01-01', quantity: 10, bonusQuantity: 0, tradePrice: 50, mrp: 70, salesTax: 3, aitCollectiblePercent: 2, aitPayablePercent: 1 }] }) })
    const pi = (await json(r)).data
    ids.purchaseInvoices.push(pi.id)
    const piRow = await prisma.purchaseInvoice.findUnique({ where: { id: pi.id } })
    check('scenario: purchase invoice has sales tax + AIT', Number(piRow!.salesTaxTotal) === 30 && Number(piRow!.aitCollectibleTotal) === 10 && Number(piRow!.aitPayableTotal) === 5, `${piRow!.salesTaxTotal}/${piRow!.aitCollectibleTotal}/${piRow!.aitPayableTotal}`)
    r = await api(`/api/purchase-invoices/${pi.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 200, method: 'CASH' }) })
    ids.supplierPayments.push((await json(r)).data.id)
    const cash = (await prisma.account.findFirst({ where: { systemKey: 'CASH' } }))!
    const otherExp = (await prisma.account.findFirst({ where: { systemKey: 'OTHER_EXPENSES' } }))!
    r = await post('/api/accounts/cash-bank/expense', { fromAccountId: cash.id, expenseAccountId: otherExp.id, amount: 200, date: goDay, memo: 'QA expense', requestId: 'qa-rep-e1' })
    check('scenario: expense posted', r.status === 201, String(r.status))
    r = await post('/api/accounts/fixed-assets', { name: QA_ASSET, category: 'QA', purchaseDate: goDay, cost: 1200, salvageValue: 0, usefulLifeMonths: 12, paidFromAccountId: cash.id, requestId: 'qa-rep-a1' })
    const asset = (await json(r))?.data
    if (asset?.id) ids.assets.push(asset.id)
    check('scenario: asset added', r.status === 201, String(r.status))
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthKey })
    const dep = (await json(r))?.data
    check('scenario: depreciation posted (100)', r.status === 200 && dep.posted.length === 1 && dep.posted[0].amount === 100, JSON.stringify(dep))

    // ---- trial balance ----
    r = await api(`/api/accounts/reports/trial-balance?asOf=${lastDay}`, ACCT)
    const tb = (await json(r)).data
    check('trial balance: debits == credits, balanced flag', r.status === 200 && tb.balanced === true && paisa(tb.totalDebit) === paisa(tb.totalCredit) && tb.rows.length > 5, `${tb.totalDebit}/${tb.totalCredit}`)
    const sumRows = tb.rows.reduce((s: number, x: any) => s + paisa(x.debit), 0)
    check('trial balance: row debits add to total', sumRows === paisa(tb.totalDebit))
    const dbTotals = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
    const byAcc = await prisma.journalLine.groupBy({ by: ['accountId'], _sum: { debit: true, credit: true } })
    const netDebit = byAcc.reduce((a, g) => a + Math.max(0, paisa(g._sum.debit) - paisa(g._sum.credit)), 0)
    check('trial balance total == sum of net debit balances from DB', paisa(tb.totalDebit) === netDebit && paisa(dbTotals._sum.debit) === paisa(dbTotals._sum.credit), `${tb.totalDebit}/${netDebit / 100}`)
    const tbEarly = (await json(await api('/api/accounts/reports/trial-balance?asOf=2000-01-01', ACCT))).data
    check('trial balance as of long ago: empty, balanced', tbEarly.rows.length === 0 && tbEarly.balanced === true)
    const tbZero = (await json(await api(`/api/accounts/reports/trial-balance?asOf=${lastDay}&includeZero=1`, ACCT))).data
    check('includeZero lists every account', tbZero.rows.length >= 19 && tbZero.rows.length > tb.rows.length)

    // ---- P&L vs independent computation from source records ----
    const sales = Number(inv!.subtotal) - Number(inv!.discountAmount)
    const sr = await prisma.salesReturn.findUnique({ where: { id: sret.id } })
    const returns = Number(sr!.totalAmount)
    const cogs = 10 * Number(batch.purchasePrice) - 2 * Number(batch.purchasePrice) // delivered 10, 2 restocked
    const fa = await prisma.fixedAsset.findUnique({ where: { id: asset.id } })
    const deprec = (Number(fa!.cost) - Number(fa!.salvageValue)) / fa!.usefulLifeMonths
    const expected = Math.round((sales - returns - cogs - 200 - deprec) * 100)
    r = await api(`/api/accounts/reports/profit-loss?from=${firstDay}&to=${lastDay}`, ACCT)
    const pl = (await json(r)).data
    check('P&L: net sales = sales - returns', paisa(pl.netSales) === paisa(sales - returns), `${pl.netSales} vs ${sales - returns}`)
    check('P&L: COGS matches source (net of restock)', paisa(pl.totalCogs) === paisa(cogs), `${pl.totalCogs} vs ${cogs}`)
    check('P&L: gross profit = net sales - COGS', paisa(pl.grossProfit) === paisa(sales - returns - cogs))
    check('P&L: expenses = expense + depreciation, listed by account', paisa(pl.totalExpenses) === paisa(200 + deprec) && pl.expenses.length === 2, JSON.stringify(pl.expenses))
    check('P&L: net profit == independent computation', paisa(pl.netProfit) === expected, `${pl.netProfit} vs ${expected / 100}`)
    const plPast = (await json(await api('/api/accounts/reports/profit-loss?from=2000-01-01&to=2000-01-31', ACCT))).data
    check('P&L for an old range is zero', plPast.netProfit === 0 && plPast.totalIncome === 0)
    const w = await json(await api(`/api/reports/profit-loss?from=${firstDay}&to=${lastDay}`, MGR))
    check('P&L wrapper == accounts endpoint', JSON.stringify(w.data) === JSON.stringify(pl))

    // ---- balance sheet ----
    r = await api(`/api/accounts/reports/balance-sheet?asOf=${lastDay}`, ACCT)
    const bs = (await json(r)).data
    check('balance sheet: balanced, assets == liabilities + equity', r.status === 200 && bs.balanced === true && paisa(bs.totalAssets) === paisa(bs.totalLiabilitiesAndEquity), `${bs.totalAssets} vs ${bs.totalLiabilitiesAndEquity}`)
    check('balance sheet: retained earnings == P&L net profit', paisa(bs.retainedEarnings) === paisa(pl.netProfit))
    check('balance sheet: accumulated depreciation negative under assets', bs.assets.some((a: any) => a.amount === -deprec))
    check('balance sheet: fixed assets 1200, tax receivable lines present', bs.assets.some((a: any) => a.amount === 1200) && bs.assets.some((a: any) => a.name === 'Sales Tax Input' && a.amount === 30))
    const bsEarly = (await json(await api('/api/accounts/reports/balance-sheet?asOf=2000-01-01', ACCT))).data
    check('balance sheet as of long ago: zero, balanced', bsEarly.totalAssets === 0 && bsEarly.balanced === true)

    // ---- tax summary ----
    r = await api(`/api/accounts/tax?from=${firstDay}&to=${lastDay}`, ACCT)
    const tax = (await json(r)).data
    check('tax: single month row', r.status === 200 && tax.months.length === 1 && tax.months[0].month === monthKey, JSON.stringify(tax.months.map((m: any) => m.month)))
    check('tax: sales tax collected == invoice taxAmount', paisa(tax.totals.salesTaxCollected) === paisa(inv!.taxAmount))
    check('tax: sales tax input == purchase salesTaxTotal', paisa(tax.totals.salesTaxInput) === paisa(piRow!.salesTaxTotal))
    check('tax: net sales tax = collected - input', paisa(tax.totals.netSalesTax) === paisa(Number(inv!.taxAmount) - Number(piRow!.salesTaxTotal)))
    check('tax: advance tax matches purchase AIT totals', paisa(tax.totals.advTaxCollected) === paisa(piRow!.aitCollectibleTotal) && paisa(tax.totals.advTaxRecoverable) === paisa(piRow!.aitPayableTotal), JSON.stringify(tax.totals))
    const taxOld = (await json(await api('/api/accounts/tax?from=2000-01-01&to=2000-12-31', ACCT))).data
    check('tax: old range empty', taxOld.months.length === 0 && taxOld.totals.netSalesTax === 0)

    // ---- pages ----
    for (const p of ['/accounts/tax', '/accounts/financial-reporting', '/reports/profit-loss']) {
      const anon = await fetch(`${BASE}${p}`, { redirect: 'manual' })
      const ok = await fetch(`${BASE}${p}`, { redirect: 'manual', headers: { cookie: ADMIN } })
      const html = await ok.text()
      check(`page ${p}: ADMIN 200 (not Coming Soon), anon redirected`, ok.status === 200 && !/Coming soon/i.test(html) && (anon.status === 307 || anon.status === 401), `${ok.status}/${anon.status}`)
    }
  } finally {
    await cleanup(orig, n0)
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
