/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA for Payroll. PRODUCTION DB — QA-prefixed records only ('QA Payroll ...' employees, their attendance, runs we create).
// Needs a dev server on :3100 (npx next dev -p 3100). Run: npx tsx tests/accounting/qa-payroll.ts
import { prisma, BASE, staffCookie, api, check } from '../portal/qa-helpers'
import { rebuildAll } from '../../lib/accounting/sync'
import { computeDeduction } from '../../lib/accounting/payroll'

const ADMIN = staffCookie('ADMIN')
const ACCT = staffCookie('ACCOUNTANT')
const PTYPES = ['PAYROLL', 'PAYROLL_PAYMENT']

async function json(res: Response) { try { return await res.json() } catch { return null } }
const post = (path: string, body: any = {}, cookie = ACCT) => api(path, cookie, { method: 'POST', body: JSON.stringify(body) })
const put = (path: string, body: any, cookie = ACCT) => api(path, cookie, { method: 'PUT', body: JSON.stringify(body) })
const del = (path: string, cookie = ACCT) => api(path, cookie, { method: 'DELETE' })
const setSettings = (b: any) => api('/api/accounts/settings', ADMIN, { method: 'PUT', body: JSON.stringify(b) })

const kNow = new Date(Date.now() + 5 * 3600_000)
const CY = kNow.getUTCFullYear()
const CM = kNow.getUTCMonth()
const monthOf = (off: number) => { const t = CY * 12 + CM + off; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}` }
const dayIn = (off: number, d: number) => `${monthOf(off)}-${String(d).padStart(2, '0')}`
const lastDay = (off: number) => { const [y, m] = monthOf(off).split('-').map(Number); return `${monthOf(off)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }
const today = kNow.toISOString().slice(0, 10)
const paisa = (n: any) => Math.round(Number(n) * 100)
const att = (employeeId: string, day: string, status: string) => ({ employeeId, date: new Date(day), status })

const r = (n: number) => Math.round(n * 100) / 100
const get = (p: string) => api(p, ACCT)

const createdRuns: string[] = []

async function cleanup(orig: { goLiveDate: Date | null; lockedThrough: Date | null; defaultBankAccountId: string | null } | null, n0: number) {
  await prisma.accountingSettings.updateMany({ data: { goLiveDate: orig?.goLiveDate ?? null, lockedThrough: orig?.lockedThrough ?? null, defaultBankAccountId: orig?.defaultBankAccountId ?? null } })
  const emps = await prisma.employee.findMany({ where: { name: { startsWith: 'QA Payroll ' } }, select: { id: true } })
  const eids = emps.map((e) => e.id)
  const lineRuns = await prisma.payrollLine.findMany({ where: { employeeId: { in: eids } }, select: { runId: true } })
  const rids = Array.from(new Set([...createdRuns, ...lineRuns.map((l) => l.runId)]))
  await prisma.journalEntry.deleteMany({ where: { sourceType: { in: PTYPES }, sourceId: { in: rids } } })
  await prisma.payrollRun.deleteMany({ where: { id: { in: rids } } })
  await prisma.attendance.deleteMany({ where: { employeeId: { in: eids } } })
  await prisma.employee.deleteMany({ where: { id: { in: eids } } })
  const n1 = await prisma.journalEntry.count()
  check('cleanup: journal entry count restored', n1 === n0, `(${n1} vs ${n0})`)
  check('cleanup: no payroll runs left', (await prisma.payrollRun.count()) === 0)
  check('cleanup: no QA employee/attendance residue', (await prisma.employee.count({ where: { name: { startsWith: 'QA Payroll ' } } })) === 0 && (await prisma.attendance.count({ where: { employeeId: { in: eids } } })) === 0)
  const s = await prisma.accountingSettings.findFirst()
  check('cleanup: settings restored', (s?.goLiveDate?.getTime() ?? null) === (orig?.goLiveDate?.getTime() ?? null) && (s?.lockedThrough?.getTime() ?? null) === (orig?.lockedThrough?.getTime() ?? null))
}

const balanced = (e: any) => e.lines.reduce((s: number, l: any) => s + paisa(l.debit), 0) === e.lines.reduce((s: number, l: any) => s + paisa(l.credit), 0) && e.lines.length >= 2
const entriesFor = (id: string) => prisma.journalEntry.findMany({ where: { sourceType: { in: PTYPES }, sourceId: id }, include: { lines: { include: { account: true } } }, orderBy: { date: 'asc' } })
const acctNet = async (systemKey: string) => {
  const a = await prisma.account.findFirst({ where: { systemKey } })
  const ls = await prisma.journalLine.findMany({ where: { accountId: a!.id }, select: { debit: true, credit: true } })
  return ls.reduce((s, l) => s + paisa(l.credit) - paisa(l.debit), 0) // credit-positive
}

async function main() {
  const n0 = await prisma.journalEntry.count()
  if (n0 !== 0) throw new Error(`Refusing to run: ${n0} journal entries already exist (expected none before go-live)`)
  if ((await prisma.payrollRun.count()) !== 0) throw new Error('Refusing to run: payroll runs already exist')
  if ((await prisma.employee.count({ where: { name: { startsWith: 'QA Payroll ' } } })) !== 0) throw new Error('Refusing to run: QA Payroll employees already exist')

  const settings0 = await prisma.accountingSettings.findFirst()
  const orig = settings0 ? { goLiveDate: settings0.goLiveDate, lockedThrough: settings0.lockedThrough, defaultBankAccountId: settings0.defaultBankAccountId } : null
  try {
    // ---- roles ----
    {
      const routes: [string, string][] = [
        ['GET', '/api/accounts/payroll'], ['POST', '/api/accounts/payroll'], ['GET', '/api/accounts/payroll/employees'],
        ['GET', '/api/accounts/payroll/x'], ['DELETE', '/api/accounts/payroll/x'], ['PUT', '/api/accounts/payroll/x/lines'],
        ['POST', '/api/accounts/payroll/x/post'], ['POST', '/api/accounts/payroll/x/pay'], ['POST', '/api/accounts/payroll/x/reopen'],
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
      check('403/401 on every payroll route for non-accounts roles', bad === 0)
    }

    // ---- QA employees + attendance ----
    const M = monthOf(-1)
    const mk = (name: string, salary: number | null, extra: any = {}) => prisma.employee.create({ data: { name: `QA Payroll ${name}`, role: 'DRIVER', salary, isActive: true, ...extra } })
    const A = await mk('A', 30000)
    const B = await mk('B', 31000)
    const C = await mk('C', 10000, { joiningDate: new Date(`${dayIn(-1, 10)}T00:00:00+05:00`) })
    const D = await mk('D', 20000, { joiningDate: new Date(`${dayIn(0, 1)}T00:00:00+05:00`) })
    const E = await mk('E', 15000, { isActive: false })
    const F = await mk('F', 0)
    await prisma.attendance.createMany({
      data: [
        att(A.id, dayIn(-1, 1), 'ABSENT'), att(A.id, dayIn(-1, 2), 'ABSENT'), att(A.id, dayIn(-1, 3), 'HALF_DAY'), att(A.id, dayIn(-1, 4), 'LEAVE'),
        att(A.id, dayIn(-1, 5), 'PRESENT'), att(A.id, dayIn(-1, 6), 'PRESENT'),
        att(A.id, lastDay(-2), 'ABSENT'), att(A.id, dayIn(0, 1), 'ABSENT'), // outside the month: must not count
        att(B.id, dayIn(-1, 7), 'HALF_DAY'),
        att(B.id, lastDay(-1), 'ABSENT'), // last day of month counts
        att(B.id, dayIn(-1, 1), 'LEAVE'),
      ],
    })
    const expA = computeDeduction(30000, 2, 1)
    const expB = computeDeduction(31000, 1, 1)
    check('expected deductions: A 2500, B (1 absent + 1 half)', expA === 2500 && expB === r(31000 / 30 * 1.5), `${expA} ${expB}`)

    // ---- validation of create ----
    const ids = [A.id, B.id, C.id]
    let res = await post('/api/accounts/payroll', { month: 'bad', employeeIds: ids })
    check('bad month -> 400', res.status === 400)
    res = await post('/api/accounts/payroll', { month: monthOf(1), employeeIds: ids })
    check('future month -> 400', res.status === 400)
    res = await post('/api/accounts/payroll', { month: M, employeeIds: [] })
    check('empty employeeIds -> 400', res.status === 400)
    res = await post('/api/accounts/payroll', { month: M, employeeIds: [A.id, E.id] })
    check('inactive employee selected -> 400', res.status === 400)
    res = await post('/api/accounts/payroll', { month: M, employeeIds: [A.id, F.id] })
    check('zero-salary employee selected -> 400', res.status === 400)
    res = await post('/api/accounts/payroll', { month: M, employeeIds: [A.id, 'nope'] })
    check('unknown employee -> 400', res.status === 400)
    check('failed creates left no run', (await prisma.payrollRun.count()) === 0)

    const pool = (await json(await api('/api/accounts/payroll/employees', ACCT))).data as any[]
    check('employees pool: includes A,B,C,D; excludes inactive E and zero-salary F', [A, B, C, D].every((e) => pool.some((p) => p.id === e.id)) && !pool.some((p) => p.id === E.id || p.id === F.id))

    // ---- default (all employees) run in an old month, then delete ----
    const M4 = monthOf(-4)
    res = await post('/api/accounts/payroll', { month: M4 })
    let j = (await json(res))?.data
    if (j?.id) createdRuns.push(j.id)
    check('default run (no employeeIds): 201; includes A,B; excludes C,D (joined after), E (inactive), F (no salary)',
      res.status === 201 && [A, B].every((e) => j.lines.some((l: any) => l.employeeId === e.id)) && ![C, D, E, F].some((e) => j.lines.some((l: any) => l.employeeId === e.id)), JSON.stringify(j?.lines?.map((l: any) => l.employeeName)))
    check('default run: A and B have no absences in that month', j.lines.find((l: any) => l.employeeId === A.id).deduction === 0)
    res = await del(`/api/accounts/payroll/${j.id}`)
    check('delete draft default run', res.status === 200 && (await prisma.payrollRun.count()) === 0)

    // ---- create run for M with QA employees ----
    res = await post('/api/accounts/payroll', { month: M, employeeIds: ids })
    j = (await json(res))?.data
    const runId = j?.id
    createdRuns.push(runId)
    const L = (eid: string) => j.lines.find((l: any) => l.employeeId === eid)
    check('create run: 201, DRAFT, 3 lines', res.status === 201 && j.status === 'DRAFT' && j.lines.length === 3)
    check('A: 2 absent, 1 half, LEAVE and out-of-month ignored, deduction 2500, net 27500', L(A.id).absentDays === 2 && L(A.id).halfDays === 1 && L(A.id).deduction === expA && L(A.id).netPay === 30000 - expA, JSON.stringify(L(A.id)))
    check('B: last-day absence counted, deduction matches computeDeduction', L(B.id).absentDays === 1 && L(B.id).halfDays === 1 && L(B.id).deduction === expB && L(B.id).netPay === r(31000 - expB), JSON.stringify(L(B.id)))
    check('C: joined mid-month flagged, not pro-rated (deduction 0, net = salary); A/B not flagged', L(C.id).joinedMidMonth === true && L(C.id).deduction === 0 && L(C.id).netPay === 10000 && !L(A.id).joinedMidMonth && !L(B.id).joinedMidMonth)
    const sumNet0 = paisa(L(A.id).netPay) + paisa(L(B.id).netPay) + paisa(L(C.id).netPay)
    check('totals.net = Σ net', paisa(j.totals.net) === sumNet0)
    res = await post('/api/accounts/payroll', { month: M, employeeIds: ids })
    check('same month again -> 409', res.status === 409 && (await prisma.payrollRun.count()) === 1)
    const [c1, c2] = await Promise.all([post('/api/accounts/payroll', { month: monthOf(-5), employeeIds: [A.id] }), post('/api/accounts/payroll', { month: monthOf(-5), employeeIds: [A.id] })])
    for (const x of [c1, c2]) { const d = (await json(x))?.data; if (d?.id) createdRuns.push(d.id) }
    check('concurrent same-month create: one 201 one 409', [c1.status, c2.status].sort().join() === '201,409', `${c1.status},${c2.status}`)
    const M5run = createdRuns[createdRuns.length - 1]
    // clean M-5 run now (also exercises delete)
    for (const rid of await prisma.payrollRun.findMany({ where: { month: monthOf(-5) }, select: { id: true } })) await del(`/api/accounts/payroll/${rid.id}`)
    check('M-5 runs deleted', (await prisma.payrollRun.count({ where: { month: monthOf(-5) } })) === 0 && !!M5run)

    // ---- edit lines ----
    const edit = (lines: any[], extra: any = {}) => put(`/api/accounts/payroll/${runId}/lines`, { lines, ...extra })
    res = await edit([{ id: L(A.id).id, deduction: 30000.01, bonus: 0 }])
    check('deduction > salary -> 400', res.status === 400)
    res = await edit([{ id: L(A.id).id, deduction: -1, bonus: 0 }])
    check('negative deduction -> 400', res.status === 400)
    res = await edit([{ id: L(A.id).id, deduction: 0, bonus: -5 }])
    check('negative bonus -> 400', res.status === 400)
    res = await edit([{ id: L(A.id).id, deduction: 0, bonus: 1e8 + 1 }])
    check('bonus > 1e8 -> 400', res.status === 400)
    res = await edit([{ id: L(A.id).id, deduction: '5', bonus: 0 }])
    check('string deduction -> 400', res.status === 400)
    res = await edit([{ id: 'not-a-line', deduction: 0, bonus: 0 }])
    check('foreign line id -> 400', res.status === 400)
    res = await edit([{ id: L(A.id).id, deduction: 0, bonus: 0 }], { expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })
    check('stale expectedUpdatedAt -> 409', res.status === 409)
    check('failed edits changed nothing', (await prisma.payrollLine.findUnique({ where: { id: L(A.id).id } }))!.deduction.toString() === String(expA))
    res = await edit([{ id: L(B.id).id, deduction: expB, bonus: 500.5, note: ' extra shift ' }, { id: L(C.id).id, deduction: 1234.56, bonus: 0.1 }], { expectedUpdatedAt: j.updatedAt })
    let e = (await json(res))?.data
    check('edit B bonus + C deduction: 200, net recomputed server-side, note trimmed',
      res.status === 200 && e.lines.find((l: any) => l.employeeId === B.id).netPay === r(31000 - expB + 500.5) && e.lines.find((l: any) => l.employeeId === C.id).netPay === r(10000 - 1234.56 + 0.1) && e.lines.find((l: any) => l.employeeId === B.id).note === 'extra shift', JSON.stringify(e?.lines))
    j = e
    const netA = paisa(L(A.id).netPay)
    const netB = paisa(j.lines.find((l: any) => l.employeeId === B.id).netPay)
    const netC = paisa(j.lines.find((l: any) => l.employeeId === C.id).netPay)
    const sumNet = netA + netB + netC
    res = await get(`/api/accounts/payroll/${runId}`)
    const g = (await json(res))?.data
    check('GET [id]: lines with names, totals, no entries yet', res.status === 200 && g.lines.length === 3 && g.lines.every((l: any) => l.employeeName.startsWith('QA Payroll ')) && g.entries.length === 0 && paisa(g.totals.net) === sumNet)
    check('GET list: run listed with totals', (await json(await get('/api/accounts/payroll'))).data.some((x: any) => x.id === runId && paisa(x.totals.net) === sumNet))

    // ---- post guards ----
    res = await post(`/api/accounts/payroll/${runId}/pay`, { fromAccountId: 'x', date: today })
    check('pay a draft run -> 409', res.status === 409 || res.status === 400)
    await prisma.accountingSettings.updateMany({ data: { goLiveDate: null } })
    res = await post(`/api/accounts/payroll/${runId}/post`)
    check('post without go-live -> 409', res.status === 409)
    res = await setSettings({ goLiveDate: new Date(`${dayIn(-1, 1)}T00:00:00+05:00`).toISOString() })
    check('settings: go-live = first of M-1', res.status === 200)
    // month entirely before go-live
    res = await post('/api/accounts/payroll', { month: monthOf(-3), employeeIds: [A.id] })
    const pre = (await json(res))?.data
    if (pre?.id) createdRuns.push(pre.id)
    res = await post(`/api/accounts/payroll/${pre.id}/post`)
    const preErr = (await json(res))?.error
    check('post a month entirely before go-live -> 409 with explanation', res.status === 409 && /go-live/.test(preErr ?? ''), preErr)
    check('nothing posted for it', (await prisma.journalEntry.count()) === 0)
    await del(`/api/accounts/payroll/${pre.id}`)
    // locked
    res = await setSettings({ lockedThrough: new Date(`${lastDay(-1)}T00:00:00+05:00`).toISOString() })
    check('settings: lock through end of M-1', res.status === 200)
    res = await post(`/api/accounts/payroll/${runId}/post`)
    check('post into locked month -> 409', res.status === 409 && (await prisma.journalEntry.count()) === 0)
    res = await setSettings({ lockedThrough: null })
    check('settings: unlock', res.status === 200)

    // ---- post (concurrent) ----
    const [p1, p2] = await Promise.all([post(`/api/accounts/payroll/${runId}/post`), post(`/api/accounts/payroll/${runId}/post`)])
    check('concurrent post: one 200, one 409', [p1.status, p2.status].sort().join() === '200,409', `${p1.status},${p2.status}`)
    let ents = await entriesFor(runId)
    check('exactly one PAYROLL entry', ents.length === 1 && ents[0].sourceType === 'PAYROLL' && !ents[0].isManual)
    const pe = ents[0]
    check('entry balanced; Dr SALARIES_EXPENSE = Σ net', balanced(pe) && pe.lines.filter((l) => l.account.systemKey === 'SALARIES_EXPENSE').reduce((s, l) => s + paisa(l.debit), 0) === sumNet, `${sumNet}`)
    const cr = pe.lines.filter((l) => l.account.systemKey === 'SALARIES_PAYABLE')
    check('Cr SALARIES_PAYABLE: one line per employee with employeeId and its net', cr.length === 3 && [[A.id, netA], [B.id, netB], [C.id, netC]].every(([id, n]) => cr.some((l) => l.employeeId === id && paisa(l.credit) === n)) && cr.reduce((s, l) => s + paisa(l.credit), 0) === sumNet)
    check('entry dated last day of month (Karachi)', new Date(pe.date.getTime() + 5 * 3600_000).toISOString().slice(0, 10) === lastDay(-1))
    check('SALARIES_PAYABLE ledger balance = Σ net (credit)', (await acctNet('SALARIES_PAYABLE')) === sumNet)
    res = await post(`/api/accounts/payroll/${runId}/post`)
    check('post again -> 409, still one entry', res.status === 409 && (await entriesFor(runId)).length === 1)
    res = await edit([{ id: L(A.id).id, deduction: 0, bonus: 0 }])
    check('edit lines of posted run -> 409', res.status === 409)
    res = await del(`/api/accounts/payroll/${runId}`)
    check('delete posted run -> 409', res.status === 409 && !!(await prisma.payrollRun.findUnique({ where: { id: runId } })))
    res = await post(`/api/accounts/journals/${pe.id}/reverse`, {})
    check('payroll entry cannot be reversed by hand -> 400', res.status === 400)

    // ---- reopen before pay, locked reopen ----
    res = await setSettings({ lockedThrough: new Date(`${lastDay(-1)}T00:00:00+05:00`).toISOString() })
    res = await post(`/api/accounts/payroll/${runId}/reopen`)
    check('re-open when entry date locked -> 409, entry kept', res.status === 409 && (await entriesFor(runId)).length === 1)
    await setSettings({ lockedThrough: null })
    res = await post(`/api/accounts/payroll/${runId}/reopen`)
    j = (await json(res))?.data
    check('re-open posted run: 200, DRAFT, entry deleted, ledger payable back to 0', res.status === 200 && j.status === 'DRAFT' && (await entriesFor(runId)).length === 0 && (await acctNet('SALARIES_PAYABLE')) === 0)
    res = await post(`/api/accounts/payroll/${runId}/reopen`)
    check('re-open a draft -> 409', res.status === 409)
    res = await edit([{ id: L(A.id).id, deduction: expA, bonus: 100 }], { expectedUpdatedAt: j.updatedAt })
    const e2 = (await json(res))?.data
    check('draft editable again after re-open (A bonus 100)', res.status === 200 && e2.lines.find((l: any) => l.employeeId === A.id).netPay === r(30000 - expA + 100))
    const netA2 = paisa(e2.lines.find((l: any) => l.employeeId === A.id).netPay)
    const sumNet2 = netA2 + netB + netC
    res = await post(`/api/accounts/payroll/${runId}/post`)
    check('post again after re-open: 200', res.status === 200)
    ents = await entriesFor(runId)
    check('re-posted entry reflects the edit (Σ net)', ents.length === 1 && ents[0].lines.filter((l) => l.account.systemKey === 'SALARIES_EXPENSE').reduce((s, l) => s + paisa(l.debit), 0) === sumNet2)

    // ---- pay ----
    const cash = (await prisma.account.findFirst({ where: { systemKey: 'CASH' } }))!
    const ar = (await prisma.account.findFirst({ where: { systemKey: 'AR' } }))!
    const expenseAcc = (await prisma.account.findFirst({ where: { systemKey: 'SALARIES_EXPENSE' } }))!
    const cash0 = await acctNet('CASH')
    const payBody = (o: any = {}) => ({ fromAccountId: cash.id, date: today, requestId: 'qa-pay-1', ...o })
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody({ fromAccountId: ar.id }))
    check('pay from AR -> 400', res.status === 400)
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody({ fromAccountId: expenseAcc.id }))
    check('pay from expense account -> 400', res.status === 400)
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody({ fromAccountId: 'nope' }))
    check('pay from unknown account -> 400', res.status === 400)
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody({ date: 'nope' }))
    check('pay invalid date -> 400', res.status === 400)
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody({ date: dayIn(-1, 15) }))
    check('pay date before posting date -> 400', res.status === 400)
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody({ date: dayIn(-2, 15) }))
    check('pay date before go-live -> 400', res.status === 400)
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody({ date: new Date(Date.now() + 3 * 86400_000 + 5 * 3600_000).toISOString().slice(0, 10) }))
    check('pay date in the future -> 400', res.status === 400 && /future/i.test((await json(res))?.error ?? ''))
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody({ requestId: 'bad id!' }))
    check('bad requestId -> 400', res.status === 400)
    await setSettings({ lockedThrough: new Date(`${today}T00:00:00+05:00`).toISOString() })
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody())
    check('pay into locked period -> 409', res.status === 409)
    await setSettings({ lockedThrough: null })
    check('failed pays posted nothing', (await prisma.journalEntry.count({ where: { sourceType: 'PAYROLL_PAYMENT' } })) === 0)
    const [q1, q2] = await Promise.all([post(`/api/accounts/payroll/${runId}/pay`, payBody()), post(`/api/accounts/payroll/${runId}/pay`, payBody())])
    check('concurrent pay: one 200, one 409', [q1.status, q2.status].sort().join() === '200,409', `${q1.status},${q2.status}`)
    ents = await entriesFor(runId)
    const pay = ents.find((x) => x.sourceType === 'PAYROLL_PAYMENT')!
    check('one PAYROLL_PAYMENT entry, balanced, Cr cash = Σ net, Dr payable per employee', ents.length === 2 && !!pay && balanced(pay) && pay.lines.filter((l) => l.accountId === cash.id).reduce((s, l) => s + paisa(l.credit), 0) === sumNet2 &&
      pay.lines.filter((l) => l.account.systemKey === 'SALARIES_PAYABLE').length === 3 && pay.lines.filter((l) => l.account.systemKey === 'SALARIES_PAYABLE').every((l) => !!l.employeeId))
    check('SALARIES_PAYABLE cleared to 0; cash reduced by Σ net', (await acctNet('SALARIES_PAYABLE')) === 0 && (await acctNet('CASH')) - cash0 === sumNet2)
    j = (await json(await get(`/api/accounts/payroll/${runId}`))).data
    check('run is PAID, shows both entries', j.status === 'PAID' && j.entries.length === 2)
    res = await post(`/api/accounts/payroll/${runId}/pay`, payBody())
    check('pay again -> 409', res.status === 409 && (await prisma.journalEntry.count({ where: { sourceType: 'PAYROLL_PAYMENT' } })) === 1)
    res = await post(`/api/accounts/payroll/${runId}/reopen`)
    check('re-open after paid -> 409, entries kept', res.status === 409 && (await entriesFor(runId)).length === 2)
    res = await del(`/api/accounts/payroll/${runId}`)
    check('delete paid run -> 409', res.status === 409)
    res = await post(`/api/accounts/payroll/${runId}/post`)
    check('post a paid run -> 409', res.status === 409)
    res = await edit([{ id: L(A.id).id, deduction: 0, bonus: 0 }])
    check('edit a paid run -> 409', res.status === 409)
    res = await get('/api/accounts/payroll/nope')
    check('GET unknown run -> 404', res.status === 404)

    // ---- sync/rebuild must not touch payroll entries ----
    const snap = async () => JSON.stringify((await prisma.journalEntry.findMany({ where: { sourceType: { in: PTYPES } }, include: { lines: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } })).map((x) => ({ id: x.id, n: x.entryNumber, d: x.date, l: x.lines.map((l) => [l.id, l.accountId, String(l.debit), String(l.credit), l.employeeId]) })))
    const before = await snap()
    const rep = await rebuildAll()
    check('rebuildAll leaves payroll entries byte-identical', before === (await snap()) && rep.errors.length === 0, `orphansRemoved ${rep.orphansRemoved}`)

    // ---- trial balance ----
    const tb = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } })
    check('trial balance: total debits == total credits', paisa(tb._sum.debit) === paisa(tb._sum.credit))
    check('every entry balanced', (await prisma.journalEntry.findMany({ include: { lines: true } })).every(balanced))

    // ---- page ----
    const anon = await fetch(`${BASE}/accounts/payroll`, { redirect: 'manual' })
    check('/accounts/payroll anonymous -> redirect/401', anon.status === 307 || anon.status === 401, `status ${anon.status}`)
    const ok = await fetch(`${BASE}/accounts/payroll`, { redirect: 'manual', headers: { cookie: ADMIN } })
    const html = await ok.text()
    check('/accounts/payroll ADMIN -> 200, not Coming Soon', ok.status === 200 && !/Coming soon/i.test(html), `status ${ok.status}`)
  } finally {
    await cleanup(orig, n0)
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
