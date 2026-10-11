// Page-status check for the Accounts UI (needs a dev server on :3100). Creates no data.
import { check, BASE, staffCookie } from '../portal/qa-helpers'

const get = (p: string, c?: string) => fetch(`${BASE}${p}`, { redirect: 'manual', headers: c ? { cookie: c } : {} })

async function main() {
  const admin = staffCookie('ADMIN')
  for (const p of ['/settings/chart-of-accounts', '/accounts/general-ledger']) {
    const anon = await get(p)
    check(`${p} anonymous -> redirect/401`, anon.status === 307 || anon.status === 401, `status ${anon.status}`)
    const ok = await get(p, admin)
    check(`${p} ADMIN -> 200`, ok.status === 200, `status ${ok.status}`)
  }
  const root = await get('/accounts', admin)
  check('/accounts -> redirect to /accounts/general-ledger', root.status === 307 && (root.headers.get('location') ?? '').includes('/accounts/general-ledger'), `status ${root.status}`)
  // read-only API smoke (no writes)
  for (const p of ['/api/accounts/accounts', '/api/accounts/settings']) {
    check(`${p} anonymous -> 401`, (await get(p)).status === 401)
    check(`${p} ADMIN -> 200`, (await get(p, admin)).status === 200)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
