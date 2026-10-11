import { prisma, check, staffCookie, api, portalLogin, cleanupQa, assertNoForeignQa, QA_PASSWORD } from './qa-helpers'

const put = (id: string, body: object, role = 'ADMIN') =>
  api(`/api/retailers/${id}/portal`, staffCookie(role), { method: 'PUT', body: JSON.stringify(body) })

async function main() {
  try {
    await assertNoForeignQa()
    const r = await prisma.retailer.create({ data: { name: 'QA Staff Portal Customer' } })
    const other = await prisma.retailer.create({ data: { name: 'QA Other Customer', portalUsername: 'qa-taken-name' } })

    // access control
    check('WAREHOUSE forbidden (403)', (await put(r.id, { username: 'qa-abc' }, 'WAREHOUSE')).status === 403)
    check('SALES_REP forbidden (403)', (await put(r.id, { username: 'qa-abc' }, 'SALES_REP')).status === 403)
    check('GET forbidden for TEAM_LEAD', (await api(`/api/retailers/${r.id}/portal`, staffCookie('TEAM_LEAD'))).status === 403)

    // validation
    const nullBody = await api(`/api/retailers/${r.id}/portal`, staffCookie(), { method: 'PUT', body: 'null' })
    check('JSON null body does not 500', nullBody.status !== 500, String(nullBody.status))
    check('enabled as string -> 400', (await put(r.id, { enabled: 'false' })).status === 400)
    check('bad username -> 400', (await put(r.id, { username: 'a b' })).status === 400)
    check('short password -> 400', (await put(r.id, { password: 'short' })).status === 400)
    check('enable with no credentials -> 400', (await put(r.id, { enabled: true })).status === 400)
    check('duplicate username -> 409', (await put(r.id, { username: 'QA-Taken-Name' })).status === 409)
    const admin = (process.env.AUTH_USERNAME ?? 'admin').toLowerCase()
    if (/^[a-z0-9._-]{3,32}$/.test(admin)) check('env-admin username -> 409', (await put(r.id, { username: admin })).status === 409)
    const emp = await prisma.employee.findFirst({ where: { username: { not: null } }, select: { username: true } })
    if (emp?.username && /^[a-z0-9._-]{3,32}$/i.test(emp.username)) check('employee username -> 409', (await put(r.id, { username: emp.username })).status === 409)

    // happy path (MANAGER allowed); username normalised
    const set = await put(r.id, { username: '  QA-Staff-User ', password: QA_PASSWORD }, 'MANAGER')
    const setJson = await set.json()
    check('set creds ok, username lowercased, hasPassword', set.status === 200 && setJson.data.portalUsername === 'qa-staff-user' && setJson.data.hasPassword === true)
    check('not enabled until staff enables', setJson.data.portalEnabled === false && (await portalLogin('qa-staff-user', QA_PASSWORD)).res.status === 401)
    check('enable ok', (await (await put(r.id, { enabled: true })).json()).data.portalEnabled === true)
    const login = await portalLogin('QA-STAFF-USER', QA_PASSWORD)
    check('customer can log in (case-insensitive)', login.res.status === 200 && !!login.cookie)

    // the hash never reaches any staff API response
    const detail = await (await api(`/api/retailers/${r.id}`, staffCookie())).text()
    const list = await (await api('/api/retailers?search=QA%20Staff', staffCookie())).text()
    const portalJson = await (await api(`/api/retailers/${r.id}/portal`, staffCookie())).text()
    check('no portalPasswordHash in customer detail/list/portal responses', ![detail, list, portalJson].some(t => /portalPasswordHash|[0-9a-f]{32}:[0-9a-f]{64}/.test(t)))

    // reset password kills existing sessions; new password works, old does not
    await put(r.id, { password: 'brand-new-password-2' })
    check('reset invalidates existing cookie', (await api('/api/portal/me', login.cookie!)).status === 401)
    check('old password rejected', (await portalLogin('qa-staff-user', QA_PASSWORD)).res.status === 401)
    check('new password accepted', (await portalLogin('qa-staff-user', 'brand-new-password-2')).res.status === 200)

    // disable kills sessions
    const live = (await portalLogin('qa-staff-user', 'brand-new-password-2')).cookie!
    await put(r.id, { enabled: false })
    check('disable invalidates cookie', (await api('/api/portal/me', live)).status === 401)

    // reset clears an active lockout
    await prisma.retailer.update({ where: { id: r.id }, data: { portalLockedUntil: new Date(Date.now() + 600_000), portalFailedAttempts: 3 } })
    await put(r.id, { password: 'another-password-3', enabled: true })
    const st = await (await api(`/api/retailers/${r.id}/portal`, staffCookie())).json()
    check('password reset clears lockout', st.data.lockedUntil === null)
    void other
  } finally {
    await cleanupQa()
    console.log('cleanup done')
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
