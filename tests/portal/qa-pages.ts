import { prisma, check, makeQaCustomer, portalLogin, cleanupQa, BASE, staffCookie } from './qa-helpers'

async function main() {
  try {
    const { username, password, retailer } = await makeQaCustomer()
    const cookie = (await portalLogin(username, password)).cookie!
    const get = (p: string, c?: string) => fetch(`${BASE}${p}`, { redirect: 'manual', headers: c ? { cookie: c } : {} })

    check('/portal/login -> 200', (await get('/portal/login')).status === 200)
    for (const p of ['/portal', '/portal/orders']) {
      const anon = await get(p)
      check(`${p} anonymous -> redirect to /portal/login`, anon.status === 307 && (anon.headers.get('location') ?? '').includes('/portal/login'))
      const staff = await get(p, staffCookie())
      check(`${p} with a STAFF cookie -> redirect (not a customer)`, staff.status === 307)
      const ok = await get(p, cookie)
      check(`${p} with customer cookie -> 200 + shows name`, ok.status === 200 && (await ok.text()).includes('QA Portal Customer'))
    }
    // staff pages are not reachable with a customer cookie
    for (const p of ['/dashboard', '/orders', '/retailers']) {
      check(`customer cookie cannot open staff page ${p}`, (await get(p, cookie)).status === 307)
    }
    // staff customer page renders (Portal access card compiles)
    check('staff customer detail page -> 200', (await get(`/retailers/${retailer.id}`, staffCookie())).status === 200)
  } finally {
    await cleanupQa()
    console.log('cleanup done')
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
