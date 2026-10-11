/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA for Fixed Assets. PRODUCTION DB — QA-prefixed records only.
// Needs a dev server on :3100 (npx next dev -p 3100). Run: npx tsx tests/accounting/qa-assets.ts
import { prisma, BASE, staffCookie, api, check } from '../portal/qa-helpers'
import { rebuildAll } from '../../lib/accounting/sync'

const ADMIN = staffCookie('ADMIN')
const ACCT = staffCookie('ACCOUNTANT')
const ASSET_TYPES = ['ASSET_PURCHASE', 'DEPRECIATION', 'ASSET_DISPOSAL']

async function json(res: Response) { try { return await res.json() } catch { return null } }
const post = (path: string, body: any, cookie = ACCT) => api(path, cookie, { method: 'POST', body: JSON.stringify(body) })
const put = (path: string, body: any, cookie = ACCT) => api(path, cookie, { method: 'PUT', body: JSON.stringify(body) })
const del = (path: string, cookie = ACCT) => api(path, cookie, { method: 'DELETE' })
const setSettings = (b: any) => api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify(b) })

// Karachi calendar helpers
const kNow = new Date(Date.now() + 5 * 3600_000)
const CY = kNow.getUTCFullYear()
const CM = kNow.getUTCMonth() // 0-based
const monthOf = (off: number) => { const t = CY * 12 + CM + off; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}` }
const dayIn = (off: number, d: number) => `${monthOf(off)}-${String(d).padStart(2, '0')}`
const lastDay = (off: number) => { const [y, m] = monthOf(off).split('-').map(Number); return `${monthOf(off)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }
const today = kNow.toISOString().slice(0, 10)
const paisa = (n: any) => Math.round(Number(n) * 100)

const created: string[] = []

async function cleanup(orig: { goLiveDate: Date | null; lockedThrough: Date | null; defaultBankAccountId: string | null } | null, n0: number) {
  await prisma.accountingSettings.updateMany({ data: { goLiveDate: orig?.goLiveDate ?? null, lockedThrough: orig?.lockedThrough ?? null, defaultBankAccountId: orig?.defaultBankAccountId ?? null } })
  const assets = await prisma.fixedAsset.findMany({ where: { name: { startsWith: 'QA ' } }, select: { id: true } })
  const ids = Array.from(new Set([...assets.map((a) => a.id), ...created]))
  await prisma.journalEntry.deleteMany({ where: { sourceType: { in: ASSET_TYPES }, OR: [{ sourceId: { in: ids } }, ...ids.map((i) => ({ sourceId: { startsWith: `${i}:` } }))] } })
  await prisma.fixedAsset.deleteMany({ where: { id: { in: ids } } })
  const n1 = await prisma.journalEntry.count()
  check('cleanup: journal entry count restored', n1 === n0, `(${n1} vs ${n0})`)
  check('cleanup: no QA asset residue', (await prisma.fixedAsset.count()) === 0)
  const s = await prisma.accountingSettings.findFirst()
  check('cleanup: settings restored', (s?.goLiveDate?.getTime() ?? null) === (orig?.goLiveDate?.getTime() ?? null) && (s?.lockedThrough?.getTime() ?? null) === (orig?.lockedThrough?.getTime() ?? null))
}

async function entriesFor(id: string) {
  return prisma.journalEntry.findMany({
    where: { sourceType: { in: ASSET_TYPES }, OR: [{ sourceId: id }, { sourceId: { startsWith: `${id}:` } }] },
    include: { lines: true }, orderBy: [{ date: 'asc' }, { entryNumber: 'asc' }],
  })
}
const balanced = (e: any) => e.lines.reduce((s: number, l: any) => s + paisa(l.debit), 0) === e.lines.reduce((s: number, l: any) => s + paisa(l.credit), 0) && e.lines.length >= 2
const balances = async () => {
  const j = await json(await api('/api/accounts/accounts?balances=1', ACCT))
  const m: Record<string, number> = {}
  for (const a of j.data) if (a.systemKey) m[a.systemKey] = a.balance
  return m
}
const depSum = async (id: string) => (await entriesFor(id)).filter((e) => e.sourceType === 'DEPRECIATION').reduce((s, e) => s + e.lines.filter((l) => Number(l.credit) > 0).reduce((x, l) => x + paisa(l.credit), 0), 0)

async function main() {
  const n0 = await prisma.journalEntry.count()
  if (n0 !== 0) throw new Error(`Refusing to run: ${n0} journal entries already exist (expected none before go-live)`)
  if ((await prisma.fixedAsset.count()) !== 0) throw new Error('Refusing to run: fixed assets already exist')

  const settings0 = await prisma.accountingSettings.findFirst()
  const orig = settings0 ? { goLiveDate: settings0.goLiveDate, lockedThrough: settings0.lockedThrough, defaultBankAccountId: settings0.defaultBankAccountId } : null
  try {
    // ---- roles ----
    {
      const routes: [string, string][] = [
        ['GET', '/api/accounts/fixed-assets'], ['POST', '/api/accounts/fixed-assets'], ['POST', '/api/accounts/fixed-assets/depreciation'],
        ['GET', '/api/accounts/fixed-assets/x'], ['PUT', '/api/accounts/fixed-assets/x'], ['DELETE', '/api/accounts/fixed-assets/x'], ['POST', '/api/accounts/fixed-assets/x/dispose'],
      ]
      let bad = 0
      for (const [method, path] of routes) {
        for (const role of ['MANAGER', 'SALES_REP', 'TEAM_LEAD']) {
          const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: staffCookie(role), 'content-type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' })
          if (r.status !== 403) { bad++; console.log('  expected 403', role, method, path, '->', r.status) }
        }
        const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' })
        if (r.status !== 401) { bad++; console.log('  expected 401 no cookie', method, path, '->', r.status) }
      }
      check('403/401 on every fixed-assets route for non-accounts roles', bad === 0)
    }

    const cashAcc = (await prisma.account.findFirst({ where: { systemKey: 'CASH' } }))!
    const equity = (await prisma.account.findFirst({ where: { systemKey: 'OPENING_EQUITY' } }))!
    const ar = (await prisma.account.findFirst({ where: { systemKey: 'AR' } }))!
    const ap = (await prisma.account.findFirst({ where: { systemKey: 'AP' } }))!
    const expense = (await prisma.account.findFirst({ where: { systemKey: 'OTHER_EXPENSES' } }))!
    const mk = (over: any = {}) => ({ name: 'QA Asset', category: 'QA', purchaseDate: dayIn(-3, 5), cost: 1000, salvageValue: 100, usefulLifeMonths: 3, paidFromAccountId: cashAcc.id, ...over })

    // ---- no go-live ----
    let r = await post('/api/accounts/fixed-assets', mk({ name: 'QA Asset A' }))
    check('add without go-live -> 409', r.status === 409)
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthOf(-1) })
    check('run depreciation without go-live -> 409', r.status === 409)
    r = await setSettings({ goLiveDate: new Date(`${dayIn(-3, 1)}T00:00:00+05:00`).toISOString() })
    check('settings: go-live = first of month -3', r.status === 200)
    const b0 = await balances()

    // ---- validation ----
    const v = async (name: string, body: any, status: number) => { const x = await post('/api/accounts/fixed-assets', body); check(name, x.status === status, `got ${x.status}`) }
    await v('before go-live date -> 400', mk({ purchaseDate: dayIn(-4, 5) }), 400)
    await v('cost 0 -> 400', mk({ cost: 0 }), 400)
    await v('cost string -> 400', mk({ cost: '5' }), 400)
    await v('cost > 1e9 -> 400', mk({ cost: 1e9 + 1 }), 400)
    await v('negative salvage -> 400', mk({ salvageValue: -1 }), 400)
    await v('life 0 -> 400', mk({ usefulLifeMonths: 0 }), 400)
    await v('life 1.5 -> 400', mk({ usefulLifeMonths: 1.5 }), 400)
    await v('blank name -> 400', mk({ name: '  ' }), 400)
    await v('bad date -> 400', mk({ purchaseDate: '2026-02-31' }), 400)
    await v('AR funding -> 400', mk({ paidFromAccountId: ar.id }), 400)
    await v('AP funding -> 400', mk({ paidFromAccountId: ap.id }), 400)
    await v('expense-account funding -> 400', mk({ paidFromAccountId: expense.id }), 400)
    await v('unknown funding account -> 400', mk({ paidFromAccountId: 'nope' }), 400)
    check('validation failures posted nothing', (await prisma.journalEntry.count()) === 0 && (await prisma.fixedAsset.count()) === 0)

    // ---- add A and B ----
    r = await post('/api/accounts/fixed-assets', mk({ name: 'QA Asset A', requestId: 'qa-a1' }))
    const A = (await json(r))?.data
    created.push(A?.id)
    check('add A: 201, id from requestId, book value = cost', r.status === 201 && A.id === 'fa-qa-a1' && A.bookValue === 1000 && A.accumulatedDepreciation === 0 && A.monthlyDepreciation === 300, JSON.stringify(A))
    r = await post('/api/accounts/fixed-assets', mk({ name: 'QA Asset A', requestId: 'qa-a1' }))
    check('duplicate requestId -> 409, one asset', r.status === 409 && (await prisma.fixedAsset.count()) === 1)
    const eA = await entriesFor(A.id)
    check('A: one ASSET_PURCHASE entry, balanced, not manual, Dr FIXED_ASSETS / Cr cash',
      eA.length === 1 && eA[0].sourceType === 'ASSET_PURCHASE' && !eA[0].isManual && balanced(eA[0]) && eA[0].lines.some((l) => Number(l.debit) === 1000) && eA[0].lines.some((l) => l.accountId === cashAcc.id && Number(l.credit) === 1000))
    const rv = await post(`/api/accounts/journals/${eA[0].id}/reverse`, {})
    check('asset purchase entry cannot be reversed by hand -> 400', rv.status === 400)
    const [rA, rB] = await Promise.all([
      post('/api/accounts/fixed-assets', mk({ name: 'QA Asset B', purchaseDate: dayIn(-3, 6), cost: 1000.01, salvageValue: 0, paidFromAccountId: equity.id, requestId: 'qa-b1' })),
      post('/api/accounts/fixed-assets', mk({ name: 'QA Asset B', purchaseDate: dayIn(-3, 6), cost: 1000.01, salvageValue: 0, paidFromAccountId: equity.id, requestId: 'qa-b1' })),
    ])
    check('concurrent same requestId: one 201 one 409', [rA.status, rB.status].sort().join() === '201,409', `${rA.status},${rB.status}`)
    const B = (await json(rA.status === 201 ? rA : rB))?.data
    created.push(B?.id)
    const b1 = await balances()
    check('FIXED_ASSETS up by 2000.01, cash down 1000, equity credited 1000.01', Math.round((b1.FIXED_ASSETS - b0.FIXED_ASSETS) * 100) === 200001 && Math.round((b0.CASH - b1.CASH) * 100) === 100000 && Math.round((b1.OPENING_EQUITY - b0.OPENING_EQUITY) * 100) === 100001, JSON.stringify({ fa: b1.FIXED_ASSETS, cash: b1.CASH, eq: b1.OPENING_EQUITY }))

    // ---- depreciation runs ----
    r = await post('/api/accounts/fixed-assets/depreciation', { month: 'bad' })
    check('bad month -> 400', r.status === 400)
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthOf(1) })
    check('future month -> 400', r.status === 400)
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthOf(-4) })
    let j = (await json(r))?.data
    check('month before go-live: nothing posted', r.status === 200 && j.posted.length === 0 && j.beforeGoLive === true && (await prisma.journalEntry.count({ where: { sourceType: 'DEPRECIATION' } })) === 0)
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthOf(-3) })
    j = (await json(r))?.data
    check('run M-3: 2 posted (A=300, B=333.33), dated last day of month', r.status === 200 && j.posted.length === 2 && j.posted.some((p: any) => p.name === 'QA Asset A' && p.amount === 300) && j.posted.some((p: any) => p.name === 'QA Asset B' && p.amount === 333.33), JSON.stringify(j))
    const dep1 = await prisma.journalEntry.findFirst({ where: { sourceType: 'DEPRECIATION', sourceId: `${A.id}:${monthOf(-3)}` }, include: { lines: { include: { account: true } } } })
    check('depreciation entry: Dr DEPRECIATION_EXPENSE / Cr ACCUM, balanced, dated month-end Karachi',
      !!dep1 && balanced(dep1) && dep1.lines.some((l) => l.account.systemKey === 'DEPRECIATION_EXPENSE' && Number(l.debit) === 300) && dep1.lines.some((l) => l.account.systemKey === 'ACCUM_DEPRECIATION' && Number(l.credit) === 300) &&
      new Date(dep1.date.getTime() + 5 * 3600_000).toISOString().slice(0, 10) === lastDay(-3))
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthOf(-3) })
    j = (await json(r))?.data
    check('re-run M-3: nothing new, both skipped as already posted', j.posted.length === 0 && j.skipped.length === 2 && j.skipped.every((s: any) => /Already posted/.test(s.reason)))
    const [x1, x2] = await Promise.all([post('/api/accounts/fixed-assets/depreciation', { month: monthOf(-2) }), post('/api/accounts/fixed-assets/depreciation', { month: monthOf(-2) })])
    const px = [(await json(x1)).data.posted.length, (await json(x2)).data.posted.length].sort().join()
    check('concurrent runs of M-2: entries posted exactly once in total', px === '0,2' && (await prisma.journalEntry.count({ where: { sourceType: 'DEPRECIATION', sourceId: { in: [`${A.id}:${monthOf(-2)}`, `${B.id}:${monthOf(-2)}`] } } })) === 2, px)

    // ---- more assets: C, E, D (month -1), F (today) ----
    const mkAsset = async (body: any) => { const x = await post('/api/accounts/fixed-assets', body); const d = (await json(x))?.data; if (d?.id) created.push(d.id); return { status: x.status, d } }
    const C = (await mkAsset(mk({ name: 'QA Asset C', purchaseDate: dayIn(-1, 10), cost: 1200, salvageValue: 0, usefulLifeMonths: 12 }))).d
    const E = (await mkAsset(mk({ name: 'QA Asset E', purchaseDate: dayIn(-1, 12), cost: 600, salvageValue: 0, usefulLifeMonths: 6 }))).d
    const D = (await mkAsset(mk({ name: 'QA Asset D', purchaseDate: dayIn(-1, 15), cost: 500, salvageValue: 0, usefulLifeMonths: 5 }))).d
    const F = (await mkAsset(mk({ name: 'QA Asset F', purchaseDate: today, cost: 300, salvageValue: 0, usefulLifeMonths: 3 }))).d
    check('C, E, D, F created', !!(C && E && D && F))

    // ---- edit before depreciation ----
    const fa0 = (await balances()).FIXED_ASSETS
    r = await put(`/api/accounts/fixed-assets/${D.id}`, { cost: 800, paidFromAccountId: equity.id })
    const Dn = (await json(r))?.data
    const eD = await entriesFor(D.id)
    check('edit D cost+funding before depreciation: entry re-posted (single, 800, credit equity)', r.status === 200 && Dn.cost === 800 && eD.length === 1 && eD[0].lines.some((l) => Number(l.debit) === 800) && eD[0].lines.some((l) => l.accountId === equity.id && Number(l.credit) === 800) && Math.round(((await balances()).FIXED_ASSETS - fa0) * 100) === 30000)
    r = await put(`/api/accounts/fixed-assets/${D.id}`, { cost: -5 })
    check('edit: invalid cost -> 400', r.status === 400)
    r = await put(`/api/accounts/fixed-assets/${D.id}`, { paidFromAccountId: ar.id })
    check('edit: AR funding -> 400', r.status === 400)

    // ---- locked month ----
    r = await setSettings({ lockedThrough: new Date(`${lastDay(-1)}T00:00:00+05:00`).toISOString() })
    check('settings: lock through end of M-1', r.status === 200)
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthOf(-1) })
    j = (await json(r))?.data
    check('run M-1 while locked: nothing posted, all skipped with locked reason', j.posted.length === 0 && j.skipped.length >= 5 && j.skipped.filter((s: any) => /locked/.test(s.reason)).length >= 5, JSON.stringify(j.skipped?.map((s: any) => s.reason)))
    r = await put(`/api/accounts/fixed-assets/${E.id}`, { cost: 700 })
    check('edit E whose purchase date is locked -> 409', r.status === 409)
    r = await del(`/api/accounts/fixed-assets/${E.id}`)
    check('delete E in locked period -> 409, still there', r.status === 409 && !!(await prisma.fixedAsset.findUnique({ where: { id: E.id } })))
    await v('add asset in locked period -> 409', mk({ name: 'QA Asset L', purchaseDate: dayIn(-1, 3) }), 409)
    r = await post(`/api/accounts/fixed-assets/${E.id}/dispose`, { date: dayIn(-1, 20) })
    check('dispose in locked period -> 409', r.status === 409)
    r = await setSettings({ lockedThrough: null })
    check('settings: unlock', r.status === 200)

    // ---- M-1 run, idempotent ----
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthOf(-1) })
    j = (await json(r))?.data
    check('run M-1: 5 posted (A,B,C,D,E), F skipped (not in service)', j.posted.length === 5 && j.skipped.some((s: any) => s.name === 'QA Asset F' && /Nothing to depreciate/.test(s.reason)) && j.failed.length === 0, JSON.stringify({ p: j.posted.map((x: any) => x.name + x.amount), s: j.skipped }))
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthOf(-1) })
    j = (await json(r))?.data
    check('re-run M-1: 0 posted', j.posted.length === 0)
    check('exactly one DEPRECIATION entry per asset-month', (await prisma.journalEntry.groupBy({ by: ['sourceId'], where: { sourceType: 'DEPRECIATION' }, _count: true })).every((g) => g._count === 1))
    check('full-life sum: A = 900.00 (cost - salvage), B = 1000.01 (remainder in last month)', (await depSum(A.id)) === 90000 && (await depSum(B.id)) === 100001)
    const bLast = await prisma.journalEntry.findFirst({ where: { sourceType: 'DEPRECIATION', sourceId: `${B.id}:${monthOf(-1)}` }, include: { lines: true } })
    check('B last month carries the rounding remainder (333.35)', !!bLast && bLast.lines.some((l) => Number(l.debit) === 333.35))
    const list = (await json(await api('/api/accounts/fixed-assets', ACCT)))
    const lA = list.data.find((a: any) => a.id === A.id)
    check('register: A accumulated 900, book value 100 (= salvage), still ACTIVE', lA.accumulatedDepreciation === 900 && lA.bookValue === 100 && lA.status === 'ACTIVE', JSON.stringify(lA))
    // ---- edit / delete after depreciation ----
    r = await put(`/api/accounts/fixed-assets/${D.id}`, { cost: 900 })
    check('edit cost after depreciation -> 409', r.status === 409)
    r = await put(`/api/accounts/fixed-assets/${D.id}`, { usefulLifeMonths: 6 })
    check('edit life after depreciation -> 409', r.status === 409)
    r = await put(`/api/accounts/fixed-assets/${D.id}`, { name: 'QA Asset D renamed', category: 'QA2', notes: 'n' })
    check('rename/category/notes allowed after depreciation', r.status === 200 && (await json(r)).data.name === 'QA Asset D renamed')
    r = await put(`/api/accounts/fixed-assets/${D.id}`, { cost: 800, name: 'QA Asset D' })
    check('same cost value resubmitted is not a financial change (200)', r.status === 200)
    r = await del(`/api/accounts/fixed-assets/${D.id}`)
    check('delete after depreciation -> 409', r.status === 409)
    const fBefore = await entriesFor(F.id)
    r = await del(`/api/accounts/fixed-assets/${F.id}`)
    check('delete F (no depreciation): 200, asset and purchase entry gone', r.status === 200 && !(await prisma.fixedAsset.findUnique({ where: { id: F.id } })) && fBefore.length === 1 && (await entriesFor(F.id)).length === 0)
    r = await del(`/api/accounts/fixed-assets/${F.id}`)
    check('delete again -> 404', r.status === 404)
    const g = await json(await api(`/api/accounts/fixed-assets/${C.id}`, ACCT))
    check('GET [id] returns asset + its entries', g.data.id === C.id && g.data.entries.length === 2)

    // ---- dispose ----
    r = await post(`/api/accounts/fixed-assets/${E.id}/dispose`, { date: dayIn(-3, 7) })
    check('dispose before purchase date -> 400', r.status === 400)
    r = await post(`/api/accounts/fixed-assets/${E.id}/dispose`, { date: dayIn(-1, 13) })
    check('dispose before last depreciation entry -> 400', r.status === 400)
    r = await post(`/api/accounts/fixed-assets/${C.id}/dispose`, { date: 'nope' })
    check('dispose invalid date -> 400', r.status === 400)
    const bBefore = await balances()
    r = await post(`/api/accounts/fixed-assets/${C.id}/dispose`, { date: today })
    const dj = (await json(r))?.data
    check('dispose C: 200, DISPOSED, written off 1100', r.status === 200 && dj.asset.status === 'DISPOSED' && dj.writtenOff === 1100 && dj.asset.bookValue === 0, JSON.stringify(dj?.asset))
    const dis = (await entriesFor(C.id)).find((e) => e.sourceType === 'ASSET_DISPOSAL')!
    const accumId = (await prisma.account.findFirst({ where: { systemKey: 'ACCUM_DEPRECIATION' } }))!.id
    const faId = (await prisma.account.findFirst({ where: { systemKey: 'FIXED_ASSETS' } }))!.id
    check('disposal entry: Dr accum 100 + Dr other expenses 1100 / Cr fixed assets 1200, balanced',
      !!dis && balanced(dis) && dis.lines.some((l) => l.accountId === accumId && Number(l.debit) === 100) && dis.lines.some((l) => l.accountId === expense.id && Number(l.debit) === 1100) && dis.lines.some((l) => l.accountId === faId && Number(l.credit) === 1200))
    const bAfter = await balances()
    check('ledger: FIXED_ASSETS -1200, OTHER_EXPENSES +1100', Math.round((bBefore.FIXED_ASSETS - bAfter.FIXED_ASSETS) * 100) === 120000 && Math.round((bAfter.OTHER_EXPENSES - bBefore.OTHER_EXPENSES) * 100) === 110000, JSON.stringify({ fa: bAfter.FIXED_ASSETS - bBefore.FIXED_ASSETS, oe: bAfter.OTHER_EXPENSES - bBefore.OTHER_EXPENSES }))
    r = await post(`/api/accounts/fixed-assets/${C.id}/dispose`, { date: today })
    check('dispose again -> 409, still one disposal entry', r.status === 409 && (await prisma.journalEntry.count({ where: { sourceType: 'ASSET_DISPOSAL', sourceId: C.id } })) === 1)
    const [d1, d2] = await Promise.all([post(`/api/accounts/fixed-assets/${E.id}/dispose`, { date: today }), post(`/api/accounts/fixed-assets/${E.id}/dispose`, { date: today })])
    check('concurrent dispose of E: one 200, one 409', [d1.status, d2.status].sort().join() === '200,409', `${d1.status},${d2.status}`)
    r = await del(`/api/accounts/fixed-assets/${C.id}`)
    check('delete disposed asset -> 409', r.status === 409)
    r = await put(`/api/accounts/fixed-assets/${C.id}`, { cost: 5 })
    check('edit cost of disposed asset -> 409', r.status === 409)
    r = await put(`/api/accounts/fixed-assets/${C.id}`, { notes: 'disposed' })
    check('edit notes of disposed asset -> 200', r.status === 200)
    r = await post('/api/accounts/fixed-assets/depreciation', { month: monthOf(0) })
    j = (await json(r))?.data
    check('run current month: disposed and fully-depreciated assets not depreciated, D (active) is', !j.posted.some((p: any) => /Asset [ABCE]$/.test(p.name)) && (await depSum(A.id)) === 90000 && (await depSum(B.id)) === 100001 && j.posted.some((p: any) => p.name === 'QA Asset D') && (await entriesFor(C.id)).filter((e) => e.sourceType === 'DEPRECIATION').length === 1)
    r = await post(`/api/accounts/fixed-assets/${D.id}/dispose`, { date: today })
    check('dispose D today (before its current-month entry date) -> 400 unless month-end is today', r.status === 400 || today === lastDay(0), `status ${r.status}`)
    const disposedList = (await json(await api('/api/accounts/fixed-assets', ACCT))).data
    check('register totals exclude disposed assets', disposedList.find((a: any) => a.id === C.id).status === 'DISPOSED')

    // ---- sync/rebuild must not touch asset entries ----
    const snap = async () => JSON.stringify((await prisma.journalEntry.findMany({ where: { sourceType: { in: ASSET_TYPES } }, include: { lines: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } })).map((e) => ({ id: e.id, n: e.entryNumber, d: e.date, l: e.lines.map((l) => [l.id, l.accountId, String(l.debit), String(l.credit)]) })))
    const before = await snap()
    const rep = await rebuildAll()
    const after = await snap()
    check('rebuildAll leaves every asset entry byte-identical (no removes/reposts)', before === after && rep.errors.length === 0, `orphansRemoved ${rep.orphansRemoved}, removed ${rep.removed}`)

    // ---- ledger consistency ----
    const bl = await balances()
    const active = (await json(await api('/api/accounts/fixed-assets', ACCT))).data.filter((a: any) => a.status === 'ACTIVE')
    check('FIXED_ASSETS balance == cost of active assets', Math.round(bl.FIXED_ASSETS * 100) === active.reduce((s: number, a: any) => s + paisa(a.cost), 0))
    check('ACCUM balance == -(accumulated of active assets)', Math.round(bl.ACCUM_DEPRECIATION * 100) === -active.reduce((s: number, a: any) => s + paisa(a.accumulatedDepreciation), 0), `${bl.ACCUM_DEPRECIATION}`)
    const tb = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
    check('trial balance: total debits == total credits', paisa(tb._sum.debit) === paisa(tb._sum.credit))
    const unbalanced = (await prisma.journalEntry.findMany({ include: { lines: true } })).filter((e) => !balanced(e))
    check('every entry balanced', unbalanced.length === 0)

    // ---- page ----
    const anon = await fetch(`${BASE}/accounts/fixed-assets`, { redirect: 'manual' })
    check('/accounts/fixed-assets anonymous -> redirect/401', anon.status === 307 || anon.status === 401, `status ${anon.status}`)
    const ok = await fetch(`${BASE}/accounts/fixed-assets`, { redirect: 'manual', headers: { cookie: ADMIN } })
    const html = await ok.text()
    check('/accounts/fixed-assets ADMIN -> 200, not Coming Soon', ok.status === 200 && !/Coming soon/i.test(html), `status ${ok.status}`)
  } finally {
    await cleanup(orig, n0)
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
