/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA for Cash & Bank. PRODUCTION DB — QA-prefixed records only.
// Needs a dev server on :3100 (npx next dev -p 3100). Run: npx tsx tests/accounting/qa-cash.ts
import { prisma, BASE, staffCookie, api, check } from '../portal/qa-helpers'
import { syncSource } from '../../lib/accounting/sync'

const ADMIN = staffCookie('ADMIN')
const ACCT = staffCookie('ACCOUNTANT')
const QA_CUSTOMER = 'QA Cash Customer'
const QA_BANK = 'QA Cash Bank One'
const QA_BANK2 = 'QA Cash Bank Two'

async function json(res: Response) { try { return await res.json() } catch { return null } }
const ids = { orders: [] as string[], invoices: [] as string[], payments: [] as string[] }
const post = (path: string, body: any, cookie = ACCT) => api(`/api/accounts/cash-bank/${path}`, cookie, { method: 'POST', body: JSON.stringify(body) })

async function cleanup(orig: { goLiveDate: Date | null; lockedThrough: Date | null; defaultBankAccountId: string | null } | null, n0: number) {
  await prisma.accountingSettings.updateMany({ data: { goLiveDate: orig?.goLiveDate ?? null, lockedThrough: orig?.lockedThrough ?? null, defaultBankAccountId: orig?.defaultBankAccountId ?? null } })
  const rid = (await prisma.retailer.findMany({ where: { name: QA_CUSTOMER }, select: { id: true } })).map((r) => r.id)
  const orders = (await prisma.order.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const invs = (await prisma.invoice.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const pays = (await prisma.payment.findMany({ where: { retailerId: { in: rid } }, select: { id: true } })).map((o) => o.id)
  const everything = [...ids.orders, ...ids.invoices, ...ids.payments, ...orders, ...invs, ...pays]
  await prisma.journalEntry.deleteMany({ where: { OR: [{ sourceId: { in: everything } }, { createdById: 'qa', isManual: true }] } })
  await prisma.payment.deleteMany({ where: { id: { in: pays } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invs } } })
  await prisma.deliveryChallan.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.delivery.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } })
  await prisma.order.deleteMany({ where: { id: { in: orders } } })
  await prisma.medicineBatch.deleteMany({ where: { medicine: { code: { startsWith: 'QAC' } } } })
  await prisma.medicine.deleteMany({ where: { code: { startsWith: 'QAC' } } })
  await prisma.retailer.deleteMany({ where: { id: { in: rid } } })
  const qaAccts = await prisma.account.findMany({ where: { name: { in: [QA_BANK, QA_BANK2] }, isSystem: false }, select: { id: true } })
  await prisma.journalLine.deleteMany({ where: { accountId: { in: qaAccts.map((a) => a.id) } } })
  await prisma.account.deleteMany({ where: { id: { in: qaAccts.map((a) => a.id) } } })
  const n1 = await prisma.journalEntry.count()
  check('cleanup: journal entry count restored', n1 === n0, `(${n1} vs ${n0})`)
  const left = (await prisma.retailer.count({ where: { name: QA_CUSTOMER } })) + (await prisma.medicine.count({ where: { code: { startsWith: 'QAC' } } })) + (await prisma.account.count({ where: { name: { in: [QA_BANK, QA_BANK2] } } }))
  check('cleanup: no QA residue', left === 0)
  const s = await prisma.accountingSettings.findFirst()
  check('cleanup: settings restored', (s?.goLiveDate?.getTime() ?? null) === (orig?.goLiveDate?.getTime() ?? null) && (s?.lockedThrough?.getTime() ?? null) === (orig?.lockedThrough?.getTime() ?? null) && (s?.defaultBankAccountId ?? null) === (orig?.defaultBankAccountId ?? null))
}

async function listData() {
  const r = await api('/api/accounts/cash-bank', ACCT)
  const j = await json(r)
  return { status: r.status, data: (j?.data ?? []) as any[], meta: j?.meta }
}

async function main() {
  const n0 = await prisma.journalEntry.count()
  if (n0 !== 0) throw new Error(`Refusing to run: ${n0} journal entries already exist (expected none before go-live)`)
  if (await prisma.retailer.count({ where: { name: QA_CUSTOMER } }) || await prisma.account.count({ where: { name: { in: [QA_BANK, QA_BANK2] } } })) throw new Error('QA residue from a previous run exists')

  const settings0 = await prisma.accountingSettings.findFirst()
  const orig = settings0 ? { goLiveDate: settings0.goLiveDate, lockedThrough: settings0.lockedThrough, defaultBankAccountId: settings0.defaultBankAccountId } : null
  try {
    // ---- roles ----
    {
      const routes: [string, string][] = [
        ['GET', '/api/accounts/cash-bank'], ['POST', '/api/accounts/cash-bank/bank-accounts'], ['POST', '/api/accounts/cash-bank/transfer'],
        ['POST', '/api/accounts/cash-bank/expense'], ['POST', '/api/accounts/cash-bank/receipt'],
      ]
      let bad = 0
      for (const [method, path] of routes) {
        for (const role of ['MANAGER', 'SALES_REP', 'TEAM_LEAD']) {
          const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: staffCookie(role), 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })
          if (r.status !== 403) { bad++; console.log('  expected 403', role, method, path, '->', r.status) }
        }
        const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })
        if (r.status !== 401) { bad++; console.log('  expected 401 no cookie', method, path, '->', r.status) }
      }
      check('403/401 on every cash-bank route for non-accounts roles', bad === 0)
    }

    const goDay = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
    const goLive = new Date(`${goDay}T00:00:00+05:00`)
    const yesterday = new Date(goLive.getTime() - 86400000).toISOString()

    // seeded system accounts + list
    let L = await listData()
    check('list: 200, system Cash in Hand + Bank present with subTypes', L.status === 200 && L.data.some((a) => a.systemKey === 'CASH' && a.subType === 'CASH') && L.data.some((a) => a.systemKey === 'BANK' && a.subType === 'BANK'))
    const cash = L.data.find((a) => a.systemKey === 'CASH')
    const sysBank = L.data.find((a) => a.systemKey === 'BANK')

    // ---- add bank account ----
    let r = await post('bank-accounts', { name: '   ' })
    check('bank account: blank name -> 400', r.status === 400)
    r = await post('bank-accounts', { name: QA_BANK })
    const b1 = (await json(r))?.data
    check('bank account: created ASSET/BANK, code in 1011-1099, not system', r.status === 201 && b1.type === 'ASSET' && b1.subType === 'BANK' && b1.isSystem === false && +b1.code >= 1011 && +b1.code <= 1099, JSON.stringify(b1))
    r = await post('bank-accounts', { name: QA_BANK.toLowerCase() })
    check('bank account: duplicate name (case-insensitive) -> 409', r.status === 409)
    r = await post('bank-accounts', { name: QA_BANK2 })
    const b2 = (await json(r))?.data
    check('bank account 2: distinct code', r.status === 201 && b2.code !== b1.code)
    L = await listData()
    check('list: new bank accounts appear', L.data.some((a) => a.id === b1.id) && L.data.some((a) => a.id === b2.id))

    // ---- go-live gating ----
    r = await post('transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 100, date: goDay })
    check('transfer without go-live -> 409', r.status === 409)
    r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ goLiveDate: goLive.toISOString() }) })
    check('settings: set go-live', r.status === 200)
    r = await post('transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 100, date: yesterday.slice(0, 10) })
    check('transfer before go-live date -> 400', r.status === 400)

    // seed cash with an other-receipt from Opening Equity
    const equity = await prisma.account.findFirst({ where: { systemKey: 'OPENING_EQUITY' } })
    const expense = await prisma.account.findFirst({ where: { systemKey: 'OTHER_EXPENSES' } })
    const income = await prisma.account.findFirst({ where: { systemKey: 'SALES' } })
    const ar = await prisma.account.findFirst({ where: { systemKey: 'AR' } })

    // ---- receipt ----
    r = await post('receipt', { toAccountId: cash.id, sourceAccountId: equity!.id, amount: 5000, date: goDay, memo: 'QA seed', requestId: 'qa-r1' })
    const rec = (await json(r))?.data
    check('receipt: 201, manual MANUAL_CASH, createdBy qa, sourceId req:', r.status === 201 && rec.isManual === true && rec.sourceType === 'MANUAL_CASH' && rec.createdById === 'qa' && rec.sourceId === 'req:qa-r1')
    const recLines = await prisma.journalLine.findMany({ where: { entryId: rec.id } })
    check('receipt: Dr cash 5000 / Cr source 5000', recLines.some((l) => l.accountId === cash.id && Number(l.debit) === 5000) && recLines.some((l) => l.accountId === equity!.id && Number(l.credit) === 5000))
    L = await listData()
    const total0 = L.meta.total
    const bal = (id: string) => L.data.find((a) => a.id === id)?.balance
    check('cash balance 5000 after receipt', bal(cash.id) === 5000 && total0 === 5000, JSON.stringify({ c: bal(cash.id), total0 }))

    // ---- duplicate requestId ----
    r = await post('receipt', { toAccountId: cash.id, sourceAccountId: equity!.id, amount: 5000, date: goDay, requestId: 'qa-r1' })
    check('duplicate requestId -> 409', r.status === 409)
    const [d1, d2] = await Promise.all([
      post('receipt', { toAccountId: cash.id, sourceAccountId: equity!.id, amount: 1, date: goDay, requestId: 'qa-race' }),
      post('receipt', { toAccountId: cash.id, sourceAccountId: equity!.id, amount: 1, date: goDay, requestId: 'qa-race' }),
    ])
    check('concurrent same requestId: exactly one 201 and one 409', [d1.status, d2.status].sort().join() === '201,409', `${d1.status},${d2.status}`)
    check('exactly one entry per requestId', (await prisma.journalEntry.count({ where: { sourceId: 'req:qa-r1' } })) === 1 && (await prisma.journalEntry.count({ where: { sourceId: 'req:qa-race' } })) === 1)

    // ---- transfer keeps total constant ----
    L = await listData()
    const totalBefore = L.meta.total
    r = await post('transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 1234.56, date: goDay, requestId: 'qa-t1' })
    check('transfer: 201', r.status === 201)
    L = await listData()
    check('transfer: total cash+bank constant', L.meta.total === totalBefore, `${L.meta.total} vs ${totalBefore}`)
    check('transfer: cash down, bank up by 1234.56', bal(cash.id) === Math.round((5001 - 1234.56) * 100) / 100 && bal(b1.id) === 1234.56, JSON.stringify({ c: bal(cash.id), b: bal(b1.id) }))

    // ---- expense ----
    r = await post('expense', { fromAccountId: cash.id, expenseAccountId: expense!.id, amount: 200.5, date: goDay, memo: 'QA expense', requestId: 'qa-e1' })
    check('expense: 201', r.status === 201)
    const expAfter = (await (await api('/api/accounts/accounts?balances=1', ACCT)).json()).data.find((a: any) => a.id === expense!.id)
    L = await listData()
    check('expense: cash reduced by 200.5, expense account +200.5', bal(cash.id) === Math.round((5001 - 1234.56 - 200.5) * 100) / 100 && expAfter.balance === 200.5, JSON.stringify({ c: bal(cash.id), e: expAfter.balance }))
    r = await post('expense', { fromAccountId: cash.id, expenseAccountId: income!.id, amount: 1, date: goDay })
    check('expense: any non-cash account allowed (income account)', r.status === 201)

    // ---- validation ----
    const v = async (name: string, path: string, body: any, status: number) => { const x = await post(path, body); check(name, x.status === status, `got ${x.status}`) }
    await v('same account -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: cash.id, amount: 5, date: goDay }, 400)
    await v('transfer to non-cash account -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: expense!.id, amount: 5, date: goDay }, 400)
    await v('transfer from non-cash account -> 400', 'transfer', { fromAccountId: expense!.id, toAccountId: cash.id, amount: 5, date: goDay }, 400)
    await v('expense paid from non-cash -> 400', 'expense', { fromAccountId: income!.id, expenseAccountId: expense!.id, amount: 5, date: goDay }, 400)
    await v('expense to a cash/bank account -> 400', 'expense', { fromAccountId: cash.id, expenseAccountId: b1.id, amount: 5, date: goDay }, 400)
    await v('expense to AR (needs party) -> 400', 'expense', { fromAccountId: cash.id, expenseAccountId: ar!.id, amount: 5, date: goDay }, 400)
    await v('receipt into non-cash -> 400', 'receipt', { toAccountId: expense!.id, sourceAccountId: income!.id, amount: 5, date: goDay }, 400)
    await v('unknown account -> 400', 'expense', { fromAccountId: cash.id, expenseAccountId: 'nope', amount: 5, date: goDay }, 400)
    await v('amount 0 -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 0, date: goDay }, 400)
    await v('amount negative -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: -5, date: goDay }, 400)
    await v('amount rounds to zero (0.001) -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 0.001, date: goDay }, 400)
    await v('amount string -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: '5', date: goDay }, 400)
    await v('amount above 1e9 -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 1e9 + 1, date: goDay }, 400)
    await v('amount NaN-ish (null) -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: null, date: goDay }, 400)
    await v('invalid date -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 5, date: '2026-02-31' }, 400)
    await v('missing account -> 400', 'transfer', { fromAccountId: cash.id, amount: 5, date: goDay }, 400)
    r = await post('transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 0.126, date: goDay, requestId: 'qa-round' })
    const rnd = (await json(r))?.data
    const rl = await prisma.journalLine.findMany({ where: { entryId: rnd?.id } })
    check('amount rounded to paisa (0.126 -> 0.13)', r.status === 201 && rl.every((l) => [Number(l.debit), Number(l.credit)].includes(0.13)))
    r = await post('transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 1e9, date: goDay, requestId: 'qa-max' })
    check('amount exactly 1e9 accepted', r.status === 201)
    // inactive account
    await prisma.account.update({ where: { id: b2.id }, data: { isActive: false } })
    await v('transfer to inactive account -> 400', 'transfer', { fromAccountId: cash.id, toAccountId: b2.id, amount: 5, date: goDay }, 400)

    // ---- locked period ----
    await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ lockedThrough: goLive.toISOString() }) })
    r = await post('transfer', { fromAccountId: cash.id, toAccountId: b1.id, amount: 5, date: goDay, requestId: 'qa-lock' })
    check('locked period -> 409, nothing posted', r.status === 409 && (await prisma.journalEntry.count({ where: { sourceId: 'req:qa-lock' } })) === 0)
    await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ lockedThrough: null }) })

    // ---- list balance = GL ledger closing ----
    L = await listData()
    let allMatch = true
    for (const a of L.data) {
      const led = (await json(await api(`/api/accounts/ledger/${a.id}`, ACCT)))?.data
      if (!led || led.closing !== a.balance) { allMatch = false; console.log('  mismatch', a.code, a.balance, led?.closing) }
    }
    check('list balance == ledger closing for every cash/bank account', allMatch)
    r = await api(`/api/accounts/cash-bank?asOf=1999-01-01`, ACCT)
    check('asOf in the past -> zero total', (await json(r))?.meta?.total === 0)
    r = await api(`/api/accounts/cash-bank?asOf=2026-02-31`, ACCT)
    check('asOf invalid -> 400', r.status === 400)
    const journals = await json(await api(`/api/accounts/journals?accountId=${cash.id}&pageSize=5`, ACCT))
    check('journals filtered by account returns entries with lines/accounts', journals.data.length > 0 && journals.data[0].lines[0].account.code)

    // ---- default bank resolution ----
    r = await api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify({ defaultBankAccountId: b1.id }) })
    check('settings: default bank = QA bank', r.status === 200)
    L = await listData()
    check('list: flags default bank', L.data.find((a) => a.id === b1.id)?.isDefaultBank === true && L.data.find((a) => a.id === sysBank.id)?.isDefaultBank === false)
    const mfr = await prisma.manufacturer.findFirst({ select: { id: true } })
    const retailer = await prisma.retailer.create({ data: { name: QA_CUSTOMER } })
    const code = `QAC${Math.floor(Math.random() * 900000 + 100000)}`
    const med = await prisma.medicine.create({ data: { code, name: `QA CASH ITEM ${code}`, manufacturerId: mfr!.id } })
    await prisma.medicineBatch.create({ data: { medicineId: med.id, batchNumber: 'QAC-B1', expiryDate: new Date('2030-06-01'), quantityIn: 100, currentQty: 100, purchasePrice: 60, tradePrice: 100, mrp: 130 } })
    const mk = await api('/api/orders', ADMIN, { method: 'POST', body: JSON.stringify({ retailerId: retailer.id, items: [{ medicineId: med.id, quantity: 10, unitPrice: 100, offerPercent: 0, salesTax: 0 }] }) })
    const order = (await json(mk)).data
    ids.orders.push(order.id)
    await api(`/api/orders/${order.id}/status`, ADMIN, { method: 'PUT', body: JSON.stringify({ status: 'CONFIRMED' }) })
    const inv = await prisma.invoice.findUnique({ where: { orderId: order.id } })
    ids.invoices.push(inv!.id)
    const bankBefore = bal(b1.id)
    r = await api(`/api/invoices/${inv!.id}/payments`, ADMIN, { method: 'POST', body: JSON.stringify({ amount: 400, method: 'BANK_TRANSFER' }) })
    const pay = (await json(r))?.data?.payment
    ids.payments.push(pay.id)
    const payEntry = await prisma.journalEntry.findFirst({ where: { sourceType: 'PAYMENT', sourceId: pay.id }, include: { lines: true } })
    check('BANK_TRANSFER payment debits the QA default bank account', !!payEntry && payEntry.lines.some((l) => l.accountId === b1.id && Number(l.debit) === 400) && !payEntry.lines.some((l) => l.accountId === sysBank.id))
    L = await listData()
    check('QA bank balance +400 from payment', bal(b1.id) === Math.round((bankBefore + 400) * 100) / 100, `${bal(b1.id)} vs ${bankBefore}`)
    // deactivated default falls back to seeded bank (re-sync the payment)
    await prisma.account.update({ where: { id: b1.id }, data: { isActive: false } })
    const sr = await syncSource('PAYMENT', pay.id)
    const payEntry2 = await prisma.journalEntry.findFirst({ where: { sourceType: 'PAYMENT', sourceId: pay.id }, include: { lines: true } })
    check('inactive default bank falls back to the system Bank account', !!payEntry2 && payEntry2.lines.some((l) => l.accountId === sysBank.id && Number(l.debit) === 400), `sync ${sr.status}`)

    // trial balance
    const tb = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
    check('trial balance: total debits == total credits', Math.round(Number(tb._sum.debit) * 100) === Math.round(Number(tb._sum.credit) * 100))

    // ---- page ----
    const anon = await fetch(`${BASE}/accounts/cash-bank`, { redirect: 'manual' })
    check('/accounts/cash-bank anonymous -> redirect/401', anon.status === 307 || anon.status === 401, `status ${anon.status}`)
    const ok = await fetch(`${BASE}/accounts/cash-bank`, { redirect: 'manual', headers: { cookie: ADMIN } })
    const html = await ok.text()
    check('/accounts/cash-bank ADMIN -> 200, not Coming Soon', ok.status === 200 && !/Coming soon/i.test(html), `status ${ok.status}`)
  } finally {
    await cleanup(orig, n0)
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
