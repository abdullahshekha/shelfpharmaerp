// Integration QA for the accounts sync engine, hooks and APIs. PRODUCTION DB — QA-prefixed records only.
// Needs a dev server on :3100 (npx next dev -p 3100). Run: npx tsx tests/accounting/qa-sync.ts
import { prisma, BASE, staffCookie, api, check } from '../portal/qa-helpers'
import { syncSource } from '../../lib/accounting/sync'

const ADMIN = staffCookie('ADMIN')
const ACCT = staffCookie('ACCOUNTANT')
const QA_CUSTOMER = 'QA Ledger Customer'
const QA_SUPPLIER = 'QA Ledger Supplier'

const ids = {
  retailer: '', supplier: '', medicine: '', batch: '',
  orders: [] as string[], invoices: [] as string[], payments: [] as string[],
  salesReturns: [] as string[], purchaseInvoices: [] as string[], supplierPayments: [] as string[], supplierReturns: [] as string[],
}

async function json(res: Response) { try { return await res.json() } catch { return null } }

/** Net balance of a system account for a party, from the ledger (debit-normal: debit - credit). */
async function partyBalance(key: string, party: { retailerId?: string; supplierId?: string }) {
  const acc = await prisma.account.findUnique({ where: { systemKey: key } })
  const s = await prisma.journalLine.aggregate({ where: { accountId: acc!.id, ...party }, _sum: { debit: true, credit: true } })
  return Math.round((Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0)) * 100) / 100
}
async function acctSum(key: string, sourceIds: string[]) {
  const acc = await prisma.account.findUnique({ where: { systemKey: key } })
  const s = await prisma.journalLine.aggregate({ where: { accountId: acc!.id, entry: { sourceId: { in: sourceIds } } }, _sum: { debit: true, credit: true } })
  return { debit: Number(s._sum.debit ?? 0), credit: Number(s._sum.credit ?? 0) }
}
async function signature(type: string, id: string) {
  const es = await prisma.journalEntry.findMany({ where: { sourceType: type, sourceId: id }, include: { lines: { include: { account: true } } } })
  return JSON.stringify(
    es.map((e) => ({ memo: e.memo, date: e.date.toISOString(), lines: e.lines.map((l) => `${l.account.code}|${l.debit}|${l.credit}|${l.retailerId ?? ''}|${l.supplierId ?? ''}`).sort() }))
      .sort((a, b) => (a.memo ?? '').localeCompare(b.memo ?? '')),
  )
}
const entryCount = (type: string, id: string) => prisma.journalEntry.count({ where: { sourceType: type, sourceId: id } })

function allQaSourceIds() {
  return [...ids.orders, ...ids.invoices, ...ids.payments, ...ids.salesReturns, ...ids.purchaseInvoices, ...ids.supplierPayments, ...ids.supplierReturns]
}

async function cleanup(orig: { goLiveDate: Date | null; lockedThrough: Date | null; defaultBankAccountId: string | null } | null, n0: number) {
  // Settings first so no further sync can run against QA records while we delete.
  // No settings row existed before the run (getSettings creates one) -> restore to the all-null state.
  await prisma.accountingSettings.updateMany({ data: { goLiveDate: orig?.goLiveDate ?? null, lockedThrough: orig?.lockedThrough ?? null, defaultBankAccountId: orig?.defaultBankAccountId ?? null } })
  const rid = (await prisma.retailer.findMany({ where: { name: QA_CUSTOMER }, select: { id: true } })).map((r) => r.id)
  const sid = (await prisma.supplier.findMany({ where: { name: QA_SUPPLIER }, select: { id: true } })).map((r) => r.id)
  const orders = (await prisma.order.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const invs = (await prisma.invoice.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const pays = (await prisma.payment.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const srs = (await prisma.salesReturn.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const pis = (await prisma.purchaseInvoice.findMany({ where: { supplierId: { in: sid } }, select: { id: true } })).map((o) => o.id)
  const sps = (await prisma.supplierPayment.findMany({ where: { supplierId: { in: sid } }, select: { id: true } })).map((o) => o.id)
  const rets = (await prisma.supplierReturn.findMany({ where: { supplierId: { in: sid } }, select: { id: true } })).map((o) => o.id)
  const everything = [...ids.orders, ...ids.invoices, ...ids.payments, ...ids.salesReturns, ...ids.purchaseInvoices, ...ids.supplierPayments, ...ids.supplierReturns, ...orders, ...invs, ...pays, ...srs, ...pis, ...sps, ...rets]
  await prisma.journalEntry.deleteMany({ where: { OR: [{ sourceId: { in: everything } }, { createdById: 'qa', isManual: true }] } })
  await prisma.salesReturnItem.deleteMany({ where: { salesReturnId: { in: srs } } })
  await prisma.salesReturn.deleteMany({ where: { id: { in: srs } } })
  await prisma.supplierReturnItem.deleteMany({ where: { supplierReturnId: { in: rets } } })
  await prisma.supplierReturn.deleteMany({ where: { id: { in: rets } } })
  await prisma.supplierPayment.deleteMany({ where: { id: { in: sps } } })
  await prisma.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: { in: pis } } })
  await prisma.purchaseInvoice.deleteMany({ where: { id: { in: pis } } })
  await prisma.payment.deleteMany({ where: { id: { in: pays } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs } } })
  await prisma.deliveryChallan.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.delivery.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.order.deleteMany({ where: { id: { in: orders } } })
  await prisma.medicineBatch.deleteMany({ where: { medicine: { code: { startsWith: 'QAL' } } } })
  await prisma.medicine.deleteMany({ where: { code: { startsWith: 'QAL' } } })
  await prisma.retailer.deleteMany({ where: { id: { in: rid } } })
  await prisma.supplier.deleteMany({ where: { id: { in: sid } } })
  const n1 = await prisma.journalEntry.count()
  check('cleanup: journal entry count restored', n1 === n0, `(${n1} vs ${n0})`)
  const left = await prisma.retailer.count({ where: { name: QA_CUSTOMER } }) + await prisma.supplier.count({ where: { name: QA_SUPPLIER } }) + await prisma.medicine.count({ where: { code: { startsWith: 'QAL' } } })
  check('cleanup: no QA residue', left === 0)
  {
    const s = await prisma.accountingSettings.findFirst()
    check('cleanup: settings restored', (s?.goLiveDate?.getTime() ?? null) === (orig?.goLiveDate?.getTime() ?? null) && (s?.lockedThrough?.getTime() ?? null) === (orig?.lockedThrough?.getTime() ?? null) && (s?.defaultBankAccountId ?? null) === (orig?.defaultBankAccountId ?? null))
  }
}

async function main() {
  const n0 = await prisma.journalEntry.count()
  if (n0 !== 0) throw new Error(`Refusing to run: ${n0} journal entries already exist (expected none before go-live)`)
  const leftover = await prisma.retailer.count({ where: { name: QA_CUSTOMER } })
  if (leftover) throw new Error('QA residue from a previous run exists')

  const settings0 = await prisma.accountingSettings.findFirst()
  const orig = settings0 ? { goLiveDate: settings0.goLiveDate, lockedThrough: settings0.lockedThrough, defaultBankAccountId: settings0.defaultBankAccountId } : null
  let origForCleanup = orig
  try {
    // ---- role enforcement (before anything is enabled) ----
    {
      const routes: [string, string][] = [
        ['GET', '/api/accounts/settings'], ['PUT', '/api/accounts/settings'],
        ['GET', '/api/accounts/accounts'], ['POST', '/api/accounts/accounts'], ['PUT', '/api/accounts/accounts/x'],
        ['GET', '/api/accounts/journals'], ['POST', '/api/accounts/journals'], ['POST', '/api/accounts/journals/x/reverse'],
        ['GET', '/api/accounts/ledger/x'], ['POST', '/api/accounts/rebuild'],
      ]
      let bad = 0
      for (const [method, path] of routes) {
        for (const [who, cookie] of [['MANAGER', staffCookie('MANAGER')], ['SALES_REP', staffCookie('SALES_REP')]] as const) {
          const r = await fetch(`${BASE}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })
          if (r.status !== 403) { bad++; console.log('  expected 403', who, method, path, '->', r.status) }
        }
        const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })
        if (r.status !== 401) { bad++; console.log('  expected 401 no cookie', method, path, '->', r.status) }
      }
      check('403/401 on every accounts route for MANAGER/SALES_REP/no cookie', bad === 0)
    }

    // ---- fixtures ----
    const mfr = await prisma.manufacturer.findFirst({ select: { id: true } })
    const retailer = await prisma.retailer.create({ data: { name: QA_CUSTOMER } })
    const supplier = await prisma.supplier.create({ data: { name: QA_SUPPLIER, type: 'OPEN_MARKET' } })
    const code = `QAL${Math.floor(Math.random() * 900000 + 100000)}`
    const med = await prisma.medicine.create({ data: { code, name: `QA LEDGER ITEM ${code}`, manufacturerId: mfr!.id } })
    const batch = await prisma.medicineBatch.create({
      data: { medicineId: med.id, batchNumber: 'QAL-B1', expiryDate: new Date('2030-06-01'), quantityIn: 1000, currentQty: 1000, purchasePrice: 60, tradePrice: 100, mrp: 130 },
    })
    ids.retailer = retailer.id; ids.supplier = supplier.id; ids.medicine = med.id; ids.batch = batch.id

    // Real records dated from today would be picked up while go-live is set; count them to know if rebuild is safe to run.
    const k = new Date(Date.now() + 5 * 3600_000)
    const goDay = k.toISOString().slice(0, 10) // Karachi calendar day
    const goLive = new Date(`${goDay}T00:00:00+05:00`)
    const realToday =
      (await prisma.invoice.count({ where: { invoiceDate: { gte: goLive }, retailerId: { not: retailer.id } } })) +
      (await prisma.payment.count({ where: { paymentDate: { gte: goLive }, retailerId: { not: retailer.id } } })) +
      (await prisma.salesReturn.count({ where: { returnDate: { gte: goLive }, retailerId: { not: retailer.id } } })) +
      (await prisma.purchaseInvoice.count({ where: { invoiceDate: { gte: goLive }, supplierId: { not: supplier.id } } })) +
      (await prisma.supplierPayment.count({ where: { paymentDate: { gte: goLive }, supplierId: { not: supplier.id } } })) +
      (await prisma.supplierReturn.count({ where: { returnDate: { gte: goLive }, supplierId: { not: supplier.id } } })) +
      (await prisma.order.count({ where: { status: 'DELIVERED', retailerId: { not: retailer.id }, OR: [{ delivery: { is: { deliveredAt: { gte: goLive } } } }, { updatedAt: { gte: goLive } }] } }))

    // ---- settings API ----
    let r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ goLiveDate: 'garbage' }) })
    check('settings: invalid date -> 400', r.status === 400)
    r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ goLiveDate: '2026-02-31' }) })
    check('settings: impossible calendar date -> 400', r.status === 400)
    r = await api('/api/accounts/accounts?balances=1', ADMIN)
    const accList = (await json(r)).data as any[]
    check('accounts: list with balances', r.status === 200 && accList.length >= 19 && accList.every((a) => typeof a.balance === 'number'))
    const cashAcc = accList.find((a) => a.systemKey === 'CASH')
    const arAcc = accList.find((a) => a.systemKey === 'AR')
    const salesAcc = accList.find((a) => a.systemKey === 'SALES')
    r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ defaultBankAccountId: arAcc.id }) })
    check('settings: default bank must be cash/bank type', r.status === 400)
    r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ defaultBankAccountId: 'nope' }) })
    check('settings: unknown default bank -> 400', r.status === 400)
    r = await api('/api/accounts/accounts/' + arAcc.id, ADMIN, { method: 'PUT', body: JSON.stringify({ isActive: false }) })
    check('accounts: system account cannot be deactivated', r.status === 400)
    r = await api('/api/accounts/accounts/' + arAcc.id, ADMIN, { method: 'PUT', body: JSON.stringify({ code: '9999' }) })
    check('accounts: system code immutable', r.status === 400)
    r = await api('/api/accounts/accounts/' + arAcc.id, ADMIN, { method: 'PUT', body: JSON.stringify({ type: 'EXPENSE' }) })
    check('accounts: system type immutable', r.status === 400)
    r = await api('/api/accounts/accounts', ADMIN, { method: 'POST', body: JSON.stringify({ code: '1000', name: 'QA dup', type: 'ASSET' }) })
    check('accounts: duplicate code -> 409', r.status === 409)
    const qaCode = `QA${Date.now() % 100000}`
    r = await api('/api/accounts/accounts', ACCT, { method: 'POST', body: JSON.stringify({ code: qaCode, name: 'QA Temp Account', type: 'EXPENSE' }) })
    const qaAcc = (await json(r))?.data
    check('accounts: create non-system', r.status === 201 && qaAcc && qaAcc.isSystem === false)
    r = await api('/api/accounts/accounts/' + qaAcc.id, ACCT, { method: 'PUT', body: JSON.stringify({ name: 'QA Renamed', isActive: false }) })
    check('accounts: rename + deactivate non-system', r.status === 200)
    await prisma.account.delete({ where: { id: qaAcc.id } })
    // default bank account cannot be deactivated while selected
    r = await api('/api/accounts/accounts', ACCT, { method: 'POST', body: JSON.stringify({ code: `QB${Date.now() % 100000}`, name: 'QA Temp Bank', type: 'ASSET', subType: 'BANK' }) })
    const qaBank = (await json(r))?.data
    r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ defaultBankAccountId: qaBank.id }) })
    check('settings: default bank accepts an active bank account', r.status === 200)
    r = await api('/api/accounts/accounts/' + qaBank.id, ACCT, { method: 'PUT', body: JSON.stringify({ isActive: false }) })
    check('accounts: cannot deactivate the default bank account', r.status === 400 && /default bank/i.test((await json(r))?.error ?? ''))
    await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ defaultBankAccountId: null }) })
    await prisma.account.delete({ where: { id: qaBank.id } })

    // manual journals are blocked until go-live is set
    r = await api('/api/accounts/journals', ACCT, { method: 'POST', body: JSON.stringify({ memo: 'QA nogolive', lines: [{ accountId: cashAcc.id, debit: 5 }, { accountId: salesAcc.id, credit: 5 }] }) })
    check('manual journal without go-live -> 409', r.status === 409)
    r = await api('/api/accounts/ledger/' + cashAcc.id + '?from=2026-02-31', ACCT)
    check('ledger: invalid from -> 400', r.status === 400)
    r = await api('/api/accounts/journals?to=2026-02-31', ACCT)
    check('journals: invalid to -> 400', r.status === 400)

    // ---- before go-live: nothing posts ----
    const mkOrder = async (qty: number) => {
      const res = await api('/api/orders', ADMIN, { method: 'POST', body: JSON.stringify({ retailerId: retailer.id, items: [{ medicineId: med.id, quantity: qty, unitPrice: 100, offerPercent: 10, salesTax: 0 }] }) })
      const o = (await json(res)).data
      ids.orders.push(o.id)
      return o
    }
    const order = await mkOrder(10) // 10 x 100 x 0.9 = 900
    let st = await api(`/api/orders/${order.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'CONFIRMED' }) })
    check('hook: confirm without go-live succeeds and posts nothing', st.status === 200 && (await prisma.journalEntry.count()) === 0)
    const inv0 = await prisma.invoice.findUnique({ where: { orderId: order.id } })
    ids.invoices.push(inv0!.id)
    check('syncSource skipped without go-live', (await syncSource('INVOICE', inv0!.id)).status === 'skipped')

    // ---- enable go-live (today, Karachi) ----
    r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ goLiveDate: goLive.toISOString() }) })
    check('settings: set go-live (returns rebuild warning)', r.status === 200 && /Rebuild/.test((await json(r))?.warning ?? ''))
    r = await api('/api/accounts/journals', ACCT, { method: 'POST', body: JSON.stringify({ memo: 'QA early', date: '2020-01-01', lines: [{ accountId: cashAcc.id, debit: 5 }, { accountId: salesAcc.id, credit: 5 }] }) })
    check('manual journal before go-live date -> 400', r.status === 400)

    // ---- invoice via rebuild-less sync + AR matches source ----
    const s1 = await syncSource('INVOICE', inv0!.id)
    check('invoice: sync posts', s1.status === 'posted', JSON.stringify(s1))
    const invTotal = Number(inv0!.totalAmount)
    check('invoice: AR[party] == invoice total', (await partyBalance('AR', { retailerId: retailer.id })) === invTotal, String(invTotal))
    const sig1 = await signature('INVOICE', inv0!.id)
    const numsBefore = (await prisma.journalEntry.findMany({ where: { sourceId: inv0!.id }, select: { entryNumber: true } })).map((e) => e.entryNumber).join()
    const again = await syncSource('INVOICE', inv0!.id)
    await syncSource('INVOICE', inv0!.id)
    const numsAfter = (await prisma.journalEntry.findMany({ where: { sourceId: inv0!.id }, select: { entryNumber: true } })).map((e) => e.entryNumber).join()
    check('invoice: resync is unchanged and keeps SP-JV numbers', again.status === 'unchanged' && numsBefore === numsAfter, JSON.stringify(again))
    check('invoice: sync x3 identical', (await signature('INVOICE', inv0!.id)) === sig1 && (await entryCount('INVOICE', inv0!.id)) === 1)
    const sales = await acctSum('SALES', [inv0!.id])
    check('invoice: Sales credit == subtotal - discount', sales.credit === Number(inv0!.subtotal) - Number(inv0!.discountAmount))

    // ---- concurrent syncs ----
    await Promise.all(Array.from({ length: 6 }, () => syncSource('INVOICE', inv0!.id)))
    check('concurrent x6 same source: one entry set', (await entryCount('INVOICE', inv0!.id)) === 1 && (await signature('INVOICE', inv0!.id)) === sig1)
    // concurrent different sources on the same day: unique numbers, no errors
    const extra = await Promise.all([mkOrder(1), mkOrder(2), mkOrder(3), mkOrder(4), mkOrder(5), mkOrder(6)])
    await Promise.all(extra.map((o) => api(`/api/orders/${o.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'CONFIRMED' }) })))
    const extraInv = await prisma.invoice.findMany({ where: { orderId: { in: extra.map((o) => o.id) } } })
    ids.invoices.push(...extraInv.map((i) => i.id))
    check('concurrent hooks: 6 confirmations each posted exactly one invoice entry', (await Promise.all(extraInv.map((i) => entryCount('INVOICE', i.id)))).every((c) => c === 1) && extraInv.length === 6)
    const dupNums = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) - COUNT(DISTINCT "entryNumber") AS c FROM "JournalEntry"`
    check('no duplicate SP-JV numbers', Number(dupNums[0].c) === 0)
    // remove the extra orders' effects to keep arithmetic simple later
    for (const o of extra) {
      const d = await api(`/api/orders/${o.id}?hard=true`, ADMIN, { method: 'DELETE' })
      if (d.status !== 200) check('extra order delete', false, String(d.status))
    }
    check('hard delete of extra orders removes their invoice entries', (await Promise.all(extraInv.map((i) => entryCount('INVOICE', i.id)))).every((c) => c === 0))
    check('AR[party] still == invoice total after extras deleted', (await partyBalance('AR', { retailerId: retailer.id })) === invTotal)

    // ---- deliver: COGS ----
    st = await api(`/api/orders/${order.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'PICKING' }) })
    st = await api(`/api/orders/${order.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'DELIVERED' }) })
    check('hook: deliver ok', st.status === 200)
    let cogs = await acctSum('COGS', [order.id])
    check('COGS == qty x batch purchase price (10 x 60)', cogs.debit === 600 && cogs.credit === 0, JSON.stringify(cogs))
    const invCogs = await acctSum('INVENTORY', [order.id])
    check('COGS: Cr Inventory 600', invCogs.credit === 600)
    st = await api(`/api/orders/${order.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'DELIVERED' }) })
    check('double DELIVERED: still one COGS entry, amount unchanged', (await entryCount('DELIVERY_COGS', order.id)) === 1 && (await acctSum('COGS', [order.id])).debit === 600)
    check('invoice entry untouched by status changes', (await entryCount('INVOICE', inv0!.id)) === 1)
    // DRAFT invoice is void: entries removed; back to UNPAID reposts
    await prisma.invoice.update({ where: { id: inv0!.id }, data: { status: 'DRAFT' } })
    const dr = await syncSource('INVOICE', inv0!.id)
    check('DRAFT invoice: entries removed', dr.status === 'removed' && (await entryCount('INVOICE', inv0!.id)) === 0 && (await partyBalance('AR', { retailerId: retailer.id })) === 0, JSON.stringify(dr))
    await prisma.invoice.update({ where: { id: inv0!.id }, data: { status: 'UNPAID' } })
    const ur = await syncSource('INVOICE', inv0!.id)
    check('UNPAID again: entries reposted', ur.status === 'posted' && (await partyBalance('AR', { retailerId: retailer.id })) === invTotal)
    // source dated before go-live is skipped
    const oldPay = await api(`/api/invoices/${inv0!.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 1, method: 'CASH', paymentDate: '2020-01-01' }) })
    const op = (await json(oldPay)).data.payment
    ids.payments.push(op.id)
    check('pre-go-live payment: business ok, no ledger entry', oldPay.status === 201 && (await entryCount('PAYMENT', op.id)) === 0 && (await syncSource('PAYMENT', op.id)).reason === 'dated before go-live')
    await prisma.payment.delete({ where: { id: op.id } })
    ids.payments.pop()

    // ---- payments ----
    r = await api(`/api/invoices/${inv0!.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 300, method: 'CASH' }) })
    const p1 = (await json(r)).data.payment
    ids.payments.push(p1.id)
    check('payment CASH: AR[party] reduced', (await partyBalance('AR', { retailerId: retailer.id })) === invTotal - 300)
    check('payment CASH: Dr Cash in Hand 300', (await acctSum('CASH', [p1.id])).debit === 300)
    r = await api(`/api/invoices/${inv0!.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 200, method: 'BANK_TRANSFER' }) })
    const p2 = (await json(r)).data.payment
    ids.payments.push(p2.id)
    check('payment BANK: Dr Bank 200, AR == total - 500', (await acctSum('BANK', [p2.id])).debit === 200 && (await partyBalance('AR', { retailerId: retailer.id })) === invTotal - 500)

    // ---- ledger API (running balance) ----
    r = await api(`/api/accounts/ledger/${arAcc.id}?retailerId=${retailer.id}&from=${goDay}`, ACCT)
    const led = (await json(r)).data
    check('ledger API: closing == AR balance, running balance consistent', r.status === 200 && led.closing === invTotal - 500 && led.rows.length === 3 && led.rows[led.rows.length - 1].balance === led.closing && led.opening === 0, JSON.stringify({ c: led?.closing, n: led?.rows?.length }))
    r = await api(`/api/accounts/ledger/${arAcc.id}?retailerId=${retailer.id}&from=2099-01-01`, ACCT)
    const led2 = (await json(r)).data
    check('ledger API: opening before from includes earlier lines', led2.opening === invTotal - 500 && led2.rows.length === 0)
    r = await api(`/api/accounts/ledger/${salesAcc.id}`, ACCT)
    check('ledger API: credit-normal account (Sales) positive balance', (await json(r)).data.closing >= 810)

    // ---- sales return (two entries, one source) ----
    r = await api('/api/sales-returns', ADMIN, { method: 'POST', body: JSON.stringify({ retailerId: retailer.id, items: [{ medicineId: med.id, batchId: batch.id, quantity: 2, unitPrice: 90, restocked: true }] }) })
    const sret = (await json(r)).data
    ids.salesReturns.push(sret.id)
    check('sales return: 2 entries under SALES_RETURN', (await entryCount('SALES_RETURN', sret.id)) === 2)
    check('sales return: AR reduced by 180', (await partyBalance('AR', { retailerId: retailer.id })) === invTotal - 500 - 180)
    check('sales return: restock Dr Inventory 120 / Cr COGS 120', (await acctSum('INVENTORY', [sret.id])).debit === 120 && (await acctSum('COGS', [sret.id])).credit === 120)
    const sigR = await signature('SALES_RETURN', sret.id)
    await syncSource('SALES_RETURN', sret.id)
    await Promise.all(Array.from({ length: 4 }, () => syncSource('SALES_RETURN', sret.id)))
    check('sales return: re-sync (incl. concurrent) identical, still 2 entries', (await signature('SALES_RETURN', sret.id)) === sigR && (await entryCount('SALES_RETURN', sret.id)) === 2)

    // ---- purchase side ----
    r = await api('/api/purchase-invoices', ADMIN, { method: 'POST', body: JSON.stringify({ supplierId: supplier.id, items: [{ medicineId: med.id, batchNumber: 'QAL-B2', expiryDate: '2031-01-01', quantity: 10, bonusQuantity: 0, tradePrice: 50, mrp: 70 }] }) })
    const pi = (await json(r)).data
    ids.purchaseInvoices.push(pi.id)
    check('purchase invoice: AP[party] credit == total (500)', Number(pi.totalAmount) === 500 && (await partyBalance('AP', { supplierId: supplier.id })) === -500)
    check('purchase invoice: Dr Inventory 500', (await acctSum('INVENTORY', [pi.id])).debit === 500)
    r = await api(`/api/purchase-invoices/${pi.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 200, method: 'CASH' }) })
    const sp1 = (await json(r)).data
    ids.supplierPayments.push(sp1.id)
    check('supplier payment: AP[party] == -300, Cr Cash 200', (await partyBalance('AP', { supplierId: supplier.id })) === -300 && (await acctSum('CASH', [sp1.id])).credit === 200)
    const piBatch = await prisma.medicineBatch.findFirst({ where: { medicineId: med.id, batchNumber: 'QAL-B2' } })
    r = await api(`/api/suppliers/${supplier.id}/returns`, ADMIN, { method: 'POST', body: JSON.stringify({ items: [{ medicineId: med.id, batchId: piBatch!.id, quantity: 2 }] }) })
    const sr = (await json(r)).data
    ids.supplierReturns.push(sr.id)
    check('supplier return: AP[party] == -300 + 100', (await partyBalance('AP', { supplierId: supplier.id })) === -200, String(await partyBalance('AP', { supplierId: supplier.id })))
    // admin edit of purchase invoice follows
    const pid = await prisma.purchaseInvoice.findUnique({ where: { id: pi.id }, include: { items: true } })
    r = await api(`/api/purchase-invoices/${pi.id}`, ADMIN, { method: 'PUT', body: JSON.stringify({ items: [{ id: pid!.items[0].id, batchNumber: 'QAL-B2', expiryDate: '2031-01-01', quantity: 10, bonusQuantity: 0, tradePrice: 60, mrp: 70 }] }) })
    check('purchase invoice PUT: entries follow (AP -600 + 200 + 100)', r.status === 200 && (await partyBalance('AP', { supplierId: supplier.id })) === -300, String(await partyBalance('AP', { supplierId: supplier.id })))
    check('purchase invoice PUT: Dr Inventory now 600', (await acctSum('INVENTORY', [pi.id])).debit === 600 && (await entryCount('PURCHASE_INVOICE', pi.id)) === 1)

    // ---- manual journals: concurrent posting, reverse, rules ----
    const today = goDay
    const lineBody = (amt: number) => ({ memo: 'QA manual', date: today, lines: [{ accountId: cashAcc.id, debit: amt }, { accountId: arAcc.id, credit: amt, retailerId: retailer.id }] })
    const posts = await Promise.all(Array.from({ length: 6 }, (_, i) => api('/api/accounts/journals', ACCT, { method: 'POST', body: JSON.stringify(lineBody(10 + i)) })))
    const posted = await Promise.all(posts.map(json))
    check('manual journals: 6 concurrent posts all 201 with distinct numbers', posts.every((x) => x.status === 201) && new Set(posted.map((x) => x.data.entryNumber)).size === 6)
    const bad = async (lines: any[]) => (await api('/api/accounts/journals', ACCT, { method: 'POST', body: JSON.stringify({ memo: 'QA badline', date: today, lines }) })).status
    check('journal: AR line without customer -> 400', (await bad([{ accountId: arAcc.id, debit: 5 }, { accountId: cashAcc.id, credit: 5 }])) === 400)
    check('journal: customer on non-AR line -> 400', (await bad([{ accountId: cashAcc.id, debit: 5, retailerId: retailer.id }, { accountId: salesAcc.id, credit: 5 }])) === 400)
    check('journal: supplier on non-AP line -> 400', (await bad([{ accountId: cashAcc.id, debit: 5, supplierId: supplier.id }, { accountId: salesAcc.id, credit: 5 }])) === 400)
    check('journal: non-string party id -> 400', (await bad([{ accountId: arAcc.id, debit: 5, retailerId: 123 }, { accountId: cashAcc.id, credit: 5 }])) === 400)
    check('journal: unknown customer / employee -> 400', (await bad([{ accountId: arAcc.id, debit: 5, retailerId: 'nope' }, { accountId: cashAcc.id, credit: 5 }])) === 400 && (await bad([{ accountId: cashAcc.id, debit: 5, employeeId: 'nope' }, { accountId: salesAcc.id, credit: 5 }])) === 400)
    r = await api('/api/accounts/journals', ACCT, { method: 'POST', body: JSON.stringify({ memo: 'QA bad', lines: [{ accountId: cashAcc.id, debit: 5 }, { accountId: arAcc.id, credit: 4 }] }) })
    check('manual journal: unbalanced -> 400', r.status === 400)
    const m0 = posted[0].data
    check('manual journal: isManual + createdById', m0.isManual === true && m0.createdById === 'qa')
    r = await api(`/api/accounts/journals/${m0.id}/reverse`, ACCT, { method: 'POST', body: JSON.stringify({ date: '2020-01-01' }) })
    check('reverse: date before go-live -> 400', r.status === 400)
    r = await api(`/api/accounts/journals/${m0.id}/reverse`, ACCT, { method: 'POST', body: JSON.stringify({}) })
    const rev = (await json(r)).data
    check('reverse: mirrored entry with reversesId', r.status === 201 && rev.reversesId === m0.id && rev.lines.length === 2)
    const revTwice = await Promise.all([api(`/api/accounts/journals/${posted[1].data.id}/reverse`, ACCT, { method: 'POST', body: '{}' }), api(`/api/accounts/journals/${posted[1].data.id}/reverse`, ACCT, { method: 'POST', body: '{}' })])
    check('reverse: concurrent double reverse -> exactly one succeeds', revTwice.map((x) => x.status).sort().join() === '201,409', revTwice.map((x) => x.status).join())
    r = await api(`/api/accounts/journals/${m0.id}/reverse`, ACCT, { method: 'POST', body: '{}' })
    check('reverse: second reversal -> 409', r.status === 409)
    r = await api(`/api/accounts/journals/${rev.id}/reverse`, ACCT, { method: 'POST', body: '{}' })
    check('reverse: reversal of a reversal refused', r.status === 400)
    const autoEntry = await prisma.journalEntry.findFirst({ where: { sourceType: 'INVOICE', sourceId: inv0!.id } })
    r = await api(`/api/accounts/journals/${autoEntry!.id}/reverse`, ACCT, { method: 'POST', body: '{}' })
    check('reverse: auto entry refused', r.status === 400)
    r = await api('/api/accounts/journals?sourceType=MANUAL&q=QA', ACCT)
    const jl = await json(r)
    check('journals GET: filters (MANUAL + q) with lines', r.status === 200 && jl.data.length >= 7 && jl.data[0].lines.length >= 2)
    r = await api(`/api/accounts/journals?accountId=${arAcc.id}&sourceType=INVOICE&from=${today}&to=2099-01-01`, ACCT)
    check('journals GET: account/source/date filters', r.status === 200 && (await json(r)).data.some((e: any) => e.sourceId === inv0!.id))

    // ---- locked period ----
    r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ lockedThrough: today }) })
    check('settings: set lockedThrough', r.status === 200)
    const sigLocked = await signature('INVOICE', inv0!.id)
    await prisma.invoice.update({ where: { id: inv0!.id }, data: { subtotal: Number(inv0!.subtotal) + 10, totalAmount: invTotal + 10 } })
    const lk = await syncSource('INVOICE', inv0!.id)
    check('locked period: sync skipped, entries untouched', lk.status === 'skipped' && (await signature('INVOICE', inv0!.id)) === sigLocked, JSON.stringify(lk))
    r = await api('/api/accounts/journals', ACCT, { method: 'POST', body: JSON.stringify(lineBody(5)) })
    check('locked period: manual journal rejected 409', r.status === 409)
    const lockedPay = await api(`/api/invoices/${inv0!.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 1, method: 'CASH' }) })
    const lp = (await json(lockedPay)).data.payment
    ids.payments.push(lp.id)
    check('locked period: business write still succeeds, ledger skipped', lockedPay.status === 201 && (await entryCount('PAYMENT', lp.id)) === 0)
    await prisma.payment.delete({ where: { id: lp.id } })
    ids.payments.pop()
    await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ lockedThrough: null }) })
    await prisma.invoice.update({ where: { id: inv0!.id }, data: { subtotal: Number(inv0!.subtotal), totalAmount: invTotal } })
    check('after unlock + revert: nothing to change (unchanged), AR intact', (await syncSource('INVOICE', inv0!.id)).status === 'unchanged' && (await partyBalance('AR', { retailerId: retailer.id })) === invTotal - 500 - 180 + (await prisma.journalLine.aggregate({ where: { entry: { isManual: true, createdById: 'qa' }, accountId: arAcc.id }, _sum: { debit: true, credit: true } }).then((x) => Number(x._sum.debit ?? 0) - Number(x._sum.credit ?? 0))))

    // ---- builder error -> skipped, never throws ----
    const badOrder = await mkOrder(1)
    const badInv = await prisma.invoice.create({ data: { invoiceNumber: 'QA-BAD-INV', orderId: badOrder.id, retailerId: retailer.id, subtotal: 100, discountAmount: 0, taxAmount: 0, totalAmount: 150 } })
    ids.invoices.push(badInv.id)
    const be = await syncSource('INVOICE', badInv.id)
    check('bad data: sync returns skipped with reason, no entries', be.status === 'skipped' && /error/.test(be.reason ?? '') && (await entryCount('INVOICE', badInv.id)) === 0, JSON.stringify(be))
    await prisma.invoice.delete({ where: { id: badInv.id } })

    // ---- rebuild (chunked) ----
    const rebuildLoop = async (limit: number) => {
      let next: any = {}
      let chunks = 0
      const tot = { total: 0, errors: 0, posted: 0, unchanged: 0, removed: 0 }
      for (;;) {
        const res = await api('/api/accounts/rebuild', ACCT, { method: 'POST', body: JSON.stringify({ ...next, limit }) })
        const rb = (await json(res)).data
        if (res.status !== 200) throw new Error('rebuild failed ' + res.status)
        chunks++
        tot.total += rb.total; tot.errors += rb.errors.length; tot.posted += rb.posted; tot.unchanged += rb.unchanged; tot.removed += rb.removed
        if (rb.done || !rb.next) break
        next = rb.next
        if (chunks > 200) throw new Error('rebuild did not finish')
      }
      return { ...tot, chunks }
    }
    r = await api('/api/accounts/rebuild', ACCT, { method: 'POST', body: JSON.stringify({ type: 'NOPE' }) })
    check('rebuild: unknown type -> 400', r.status === 400)
    if (realToday === 0) {
      const before = await signature('INVOICE', inv0!.id)
      const nums = (await prisma.journalEntry.findMany({ select: { entryNumber: true } })).map((e) => e.entryNumber).sort().join()
      const rb = await rebuildLoop(2)
      check('rebuild: chunked (limit 2) finishes, several chunks, no errors', rb.chunks > 2 && rb.errors === 0, JSON.stringify(rb))
      check('rebuild: nothing changed, SP-JV numbers stable', rb.posted === 0 && rb.removed === 0 && rb.unchanged >= 6 && (await signature('INVOICE', inv0!.id)) === before && (await prisma.journalEntry.findMany({ select: { entryNumber: true } })).map((e) => e.entryNumber).sort().join() === nums, JSON.stringify(rb))
      // orphan removal: delete a payment row behind the engine's back, rebuild removes its entries
      const orphanPay = ids.payments[1]
      await prisma.payment.delete({ where: { id: orphanPay } })
      const rb2 = await rebuildLoop(3)
      check('rebuild: orphaned entries removed', (await entryCount('PAYMENT', orphanPay)) === 0 && rb2.errors === 0)
      ids.payments.pop()
    } else {
      console.log(`SKIP rebuild: ${realToday} real records on/after go-live would be posted`)
    }

    // ---- deletion follows ----
    const delPays = [...ids.payments]
    r = await api(`/api/orders/${order.id}?hard=true`, ADMIN, { method: 'DELETE' })
    check('hard delete order: ok', r.status === 200)
    check('hard delete: invoice, payment and COGS entries removed', (await entryCount('INVOICE', inv0!.id)) === 0 && (await entryCount('DELIVERY_COGS', order.id)) === 0 && (await Promise.all(delPays.map((p) => entryCount('PAYMENT', p)))).every((c) => c === 0))
    const manualAr = await prisma.journalLine.aggregate({ where: { entry: { isManual: true, createdById: 'qa' }, accountId: arAcc.id }, _sum: { debit: true, credit: true } })
    const expectAr = -180 + Number(manualAr._sum.debit ?? 0) - Number(manualAr._sum.credit ?? 0)
    check('hard delete: AR[party] = sales return credit + manual lines only', Math.round((await partyBalance('AR', { retailerId: retailer.id })) * 100) === Math.round(expectAr * 100))

    // trial balance
    const tb = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
    check('trial balance: total debits == total credits', Math.round(Number(tb._sum.debit) * 100) === Math.round(Number(tb._sum.credit) * 100))

    // ---- delivered order: deliveries PUT hook, soft cancel removes COGS ----
    const o3 = await mkOrder(1)
    await api(`/api/orders/${o3.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'CONFIRMED' }) })
    await api(`/api/orders/${o3.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'DELIVERED' }) })
    const inv3 = await prisma.invoice.findUnique({ where: { orderId: o3.id } })
    ids.invoices.push(inv3!.id)
    check('order 3 delivered: COGS 60 posted', (await acctSum('COGS', [o3.id])).debit === 60)
    const del3 = await prisma.delivery.findUnique({ where: { orderId: o3.id } })
    await prisma.delivery.update({ where: { id: del3!.id }, data: { deliveredAt: new Date(Date.now() - 60000) } })
    await api(`/api/deliveries/${del3!.id}`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'DELIVERED' }) })
    const afterPut = await prisma.delivery.findUnique({ where: { id: del3!.id } })
    const cogsEntry = await prisma.journalEntry.findFirst({ where: { sourceType: 'DELIVERY_COGS', sourceId: o3.id } })
    check('deliveries PUT hook: COGS entry follows deliveredAt', !!cogsEntry && cogsEntry.date.getTime() === afterPut!.deliveredAt!.getTime())
    r = await api(`/api/orders/${o3.id}`, ADMIN, { method: 'DELETE' })
    check('soft cancel delivered order: COGS entry removed, invoice entry kept', r.status === 200 && (await entryCount('DELIVERY_COGS', o3.id)) === 0 && (await entryCount('INVOICE', inv3!.id)) === 1)
    r = await api(`/api/orders/${o3.id}?hard=true`, ADMIN, { method: 'DELETE' })
    check('hard delete after soft cancel: invoice entry removed', r.status === 200 && (await entryCount('INVOICE', inv3!.id)) === 0)
  } finally {
    await cleanup(origForCleanup, n0)
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
