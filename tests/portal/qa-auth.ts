import { prisma, BASE, QA_PASSWORD, check, makeQaCustomer, portalLogin, api, staffCookie, cleanupQa } from './qa-helpers'
import { hashPassword } from '../../lib/utils/auth'

async function main() {
  try {
    const { retailer, username, password } = await makeQaCustomer()

    // login success
    const ok = await portalLogin(username, password)
    check('login ok sets sp_customer', ok.res.status === 200 && !!ok.cookie)
    const cookie = ok.cookie!

    // identical failure for wrong password vs unknown user (no account enumeration)
    const wrong = await portalLogin(username, 'definitely-wrong')
    const unknown = await portalLogin('qa-no-such-user', 'whatever123')
    check('wrong password -> 401', wrong.res.status === 401)
    check('unknown user -> identical 401 body', unknown.res.status === 401 && (await wrong.res.text()) === (await unknown.res.text()))
    check('username is case-insensitive', (await portalLogin(username.toUpperCase(), password)).res.status === 200)

    // /me
    const me = await api('/api/portal/me', cookie)
    const meJson = await me.json()
    check('/me with cookie -> 200 + name', me.status === 200 && meJson.data.name === 'QA Portal Customer')
    check('/me without cookie -> 401', (await fetch(`${BASE}/api/portal/me`)).status === 401)

    // The staff API must verify the cookie SIGNATURE, not merely its presence (pre-existing hole fixed by this task)
    const staffOk = staffCookie('ADMIN')
    check('valid staff cookie -> /api/retailers 200', (await api('/api/retailers?pageSize=1', staffOk)).status === 200)
    check('garbage sp_session -> 401', (await api('/api/retailers?pageSize=1', 'sp_session=garbage')).status === 401)
    check('empty sp_session -> 401', (await api('/api/retailers?pageSize=1', 'sp_session=')).status === 401)
    check('tampered signature -> 401', (await api('/api/retailers?pageSize=1', staffOk.slice(0, -2) + 'xx')).status === 401)
    const managerPayload = staffCookie('MANAGER').split('=')[1].split('.')[0]
    check('payload swapped onto another signature -> 401', (await api('/api/retailers?pageSize=1', `sp_session=${managerPayload}.${staffOk.split('.')[1]}`)).status === 401)
    check('customer token replayed as sp_session -> 401', (await api('/api/retailers?pageSize=1', cookie.replace('sp_customer=', 'sp_session='))).status === 401)
    // real staff login path still works end to end (QA employee; env-admin cookies use the identical format)
    const empUser = `qa-emp-${Date.now()}`
    await prisma.employee.create({ data: { name: 'QA Login Employee', role: 'MANAGER', username: empUser, passwordHash: hashPassword('qa-emp-password') } })
    const empLogin = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: empUser, password: 'qa-emp-password' }) })
    const empCookie = /sp_session=([^;]*)/.exec(empLogin.headers.get('set-cookie') ?? '')?.[1]
    check('employee login sets sp_session', empLogin.status === 200 && !!empCookie)
    check('employee cookie passes the hardened middleware', (await api('/api/retailers?pageSize=1', `sp_session=${empCookie}`)).status === 200)

    // the customer cookie must be useless against staff APIs; staff cookie useless against portal
    check('customer cookie -> /api/retailers 401', (await api('/api/retailers', cookie)).status === 401)
    check('customer cookie -> /api/invoices 401', (await api('/api/invoices', cookie)).status === 401)
    check('customer cookie -> /api/orders 401', (await api('/api/orders', cookie)).status === 401)
    check('staff cookie -> /api/portal/me 401', (await api('/api/portal/me', staffCookie())).status === 401)

    // session version bump (password reset / disable) invalidates existing cookies
    await prisma.retailer.update({ where: { id: retailer.id }, data: { portalSessionVersion: { increment: 1 } } })
    check('old cookie dead after version bump', (await api('/api/portal/me', cookie)).status === 401)
    const fresh = (await portalLogin(username, password)).cookie!
    check('fresh login works after bump', (await api('/api/portal/me', fresh)).status === 200)

    // disabled / inactive mid-session
    await prisma.retailer.update({ where: { id: retailer.id }, data: { portalEnabled: false } })
    check('disabled mid-session -> 401', (await api('/api/portal/me', fresh)).status === 401)
    check('disabled login -> 401', (await portalLogin(username, password)).res.status === 401)
    await prisma.retailer.update({ where: { id: retailer.id }, data: { portalEnabled: true, isActive: false } })
    check('inactive customer login -> 401', (await portalLogin(username, password)).res.status === 401)
    await prisma.retailer.update({ where: { id: retailer.id }, data: { isActive: true } })

    // lockout: 4 failures -> 401, 5th -> 429, then even the right password is refused until the lock lapses
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await portalLogin(username, `bad-password-${i}`)).res.status)
    check('4x401 then 429', statuses.join() === '401,401,401,401,429', statuses.join())
    check('correct password refused while locked (429)', (await portalLogin(username, password)).res.status === 429)
    await prisma.retailer.update({ where: { id: retailer.id }, data: { portalLockedUntil: new Date(Date.now() - 1000) } })
    check('login works once the lock has lapsed', (await portalLogin(username, password)).res.status === 200)
    const after = await prisma.retailer.findUnique({ where: { id: retailer.id }, select: { portalFailedAttempts: true, portalLastLoginAt: true } })
    check('counter reset + lastLogin set', after?.portalFailedAttempts === 0 && !!after.portalLastLoginAt)

    // logout clears the cookie
    const out = await fetch(`${BASE}/api/portal/logout`, { method: 'POST', headers: { cookie } })
    const outCookie = out.headers.get('set-cookie') ?? ''
    check('logout 200 clears cookie', out.status === 200 && (/sp_customer=;|sp_customer=($|,)/.test(outCookie) || /Max-Age=0/i.test(outCookie)))

    // concurrency: a parallel burst must not bypass the lockout (fresh customer, counters start at 0)
    const burst = await makeQaCustomer()
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => portalLogin(burst.username, `bad-burst-${i}`)))
    const codes = results.map(x => x.res.status)
    const n401 = codes.filter(c => c === 401).length
    const n429 = codes.filter(c => c === 429).length
    check('burst: only 401/429 returned', n401 + n429 === 12, codes.join())
    check('burst: <=5 verified attempts (401)', n401 <= 5, `401s=${n401}`)
    check('burst: >=7 refused (429)', n429 >= 7, `429s=${n429}`)
    check('burst: correct password refused while locked (429)', (await portalLogin(burst.username, burst.password)).res.status === 429)
    await prisma.retailer.update({ where: { id: burst.retailer.id }, data: { portalLockedUntil: new Date(Date.now() - 1000) } })
    check('burst: login works after lock cleared', (await portalLogin(burst.username, burst.password)).res.status === 200)
    const burstAfter = await prisma.retailer.findUnique({ where: { id: burst.retailer.id }, select: { portalFailedAttempts: true } })
    check('burst: counter reset to 0', burstAfter?.portalFailedAttempts === 0)
    void QA_PASSWORD
  } finally {
    await cleanupQa()
    console.log('cleanup done')
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
