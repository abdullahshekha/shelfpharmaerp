# Customer Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers log in to a portal, see their area's delivery days, browse the Offer List for their Customer Type, and place/edit a PENDING order (source `OFFER_LIST`) that staff confirm through the existing pipeline.

**Architecture:** A completely separate customer session (`sp_customer` cookie, scrypt passwords, lockout) so customers never hold a staff `sp_session`; all customer endpoints live under `/api/portal/*` and take the customer id only from the session. Pure logic (password/session crypto, cart validation, pricing, booking-cut-off) is isolated in DB-free modules with `node:test` unit tests; routes and pages are thin and are verified by integration scripts against the dev server.

**Tech Stack:** Next.js 14 App Router (TypeScript), Prisma 7 + `@prisma/adapter-pg` (Supabase Postgres, **production only**), Tailwind + shadcn/ui, Node `crypto` (scrypt/HMAC), `sonner` toasts, `tsx` for tests/scripts (`npx tsx`).

**Spec:** `docs/superpowers/specs/2026-10-11-customer-portal-design.md`

## Global Constraints

- Work from `C:\Users\OK COMPUTER\Desktop\AI Projects\Pharma\shelfpharma-erp` (the app root). **This directory is not a git repo — there are no commit steps. Do NOT push/deploy anything.**
- **Production DB only** (no staging): schema change is additive only (new nullable/defaulted `Retailer` columns). Check row counts before `db push`. Every integration test uses records prefixed `QA ` / `qa-` and **must delete everything it created in a `finally`**; never modify or delete anything not created by the test. Never leave a QA offer list active (see Task 4 helper).
- **`middleware.ts` must verify the `sp_session` HMAC signature** (not just presence) — a pre-existing hole the user approved fixing in Task 2. Portal tokens are signed with a *derived* key (`HMAC(secret, 'shelfpharma-portal-session-v1')`) so they can never validate as a staff session.
- Customers must never receive an `sp_session` cookie; the customer id is taken **only** from the verified `sp_customer` session, never from body/query/path.
- Portal API responses use explicit field whitelists. Never return `purchasePercent`, purchase price, batch/stock quantities, loss flags, or `portalPasswordHash`.
- Customers **cannot change their own password** (staff set/reset it).
- Password hashing for customers: scrypt + per-user 16-byte salt, `timingSafeEqual` compare. 5 consecutive failures → lock 15 minutes. Session cookie: httpOnly, sameSite lax, 7 days, `secure` in production.
- Pricing mirrors `POST /api/orders`: `lineTotal = qty × unitPrice × (1 − offerPercent/100)` excluding tax; `salesTax` only if `medicine.salesTaxApplicable`; `unitPrice = OfferListItem.specialPrice ?? FEFO batch tradePrice`; MRP snapshot from FEFO batch. Prices are always computed server-side.
- Use `Asia/Karachi` for all date/time logic. UI copy is English. Match surrounding code style (single quotes, no semicolons, 2-space indent).
- Run tests with `npx tsx --test tests/portal/<file>.test.ts`; integration scripts with `npx tsx tests/portal/<file>.ts` while a dev server runs on port 3100 (`npx next dev -p 3100`, run in background; stop it when finished).

## Review Focus

Inputs/conditions the spec implies but that are easy to get wrong (each has a test in the named task):

1. **Tampered cart** — foreign `medicineId`, client-supplied prices, quantity `0`/negative/fractional/`10000`/string, duplicate ids, empty cart → rejected or ignored, never priced from the client (Task 3 unit tests, Task 6 integration).
2. **Stale/duplicate sessions** — staff confirms the order mid-edit, or the customer has the order open in two tabs (`orderId: null` while an open order exists) → `409` and no data loss (Task 6).
3. **Account state changes mid-session** — disabled, deactivated, password reset, locked → next request is `401`, and unknown-user vs wrong-password responses are identical (Task 2).
4. **Sparse data** — customer with no area / no delivery days / no booking days / null `customerType` / no offer list / offer item with no price → portal still renders and returns `null`/empty sections, never crashes (Tasks 4, 5).
5. **Username handling** — mixed case + whitespace normalise to lowercase, login is case-insensitive, a username equal to a staff/employee/admin username is rejected, duplicate usernames return 409 (Tasks 1, 4).

## File Structure

**Create**
- `lib/utils/portal-auth.ts` — scrypt hash/verify, signed session cookie encode/decode, username/password validation, cookie constants. Pure (no DB).
- `lib/portal/session.ts` — `getPortalCustomer(token)` / `getPortalCustomerFromRequest(req)`: decode cookie + load retailer + enforce `isActive`/`portalEnabled`/`portalSessionVersion`.
- `lib/portal/pricing.ts` — pure: types, `toPublicItem`, `priceLine`, `sanitizeCart`, `buildPricedLines`.
- `lib/portal/offer-list.ts` — DB: `resolveOfferListId`, `loadOfferItems`.
- `lib/portal/order.ts` — DB: `findOpenOrder`, `serializeOrder`, `savePortalOrder` (transaction + conflict rules).
- `app/api/portal/login/route.ts`, `logout/route.ts`, `me/route.ts`, `offer-list/route.ts`, `order/route.ts`, `orders/route.ts`
- `app/api/retailers/[id]/portal/route.ts` — staff GET/PUT portal credentials.
- `components/retailers/PortalAccessCard.tsx` — staff UI card.
- `components/portal/PortalShell.tsx`; `app/portal/login/page.tsx`; `app/portal/(app)/layout.tsx`; `app/portal/(app)/page.tsx` (Order tab); `app/portal/(app)/orders/page.tsx` (My Orders)
- `tests/portal/portal-auth.test.ts`, `schedule.test.ts`, `pricing.test.ts` (unit); `tests/portal/qa-helpers.ts`, `qa-auth.ts`, `qa-staff.ts`, `qa-offer.ts`, `qa-orders.ts` (integration)

**Modify**
- `prisma/schema.prisma` (Retailer portal fields), `lib/prisma.ts` (global `omit` of the hash), `middleware.ts` (exempt `/api/portal/`), `lib/utils/area-schedule.ts` (+`nextBookingCutoff`), `app/(erp)/retailers/[id]/page.tsx` (mount the card), `../CLAUDE.md` (docs).

---

### Task 1: Schema, hash-safe Prisma client, portal-auth library

**Files:**
- Create: `lib/utils/portal-auth.ts`, `tests/portal/portal-auth.test.ts`
- Modify: `prisma/schema.prisma`, `lib/prisma.ts`

**Interfaces:**
- Produces (used by every later task):
  - `PORTAL_COOKIE = 'sp_customer'`, `PORTAL_COOKIE_OPTIONS`, `MAX_FAILED_ATTEMPTS = 5`, `LOCK_MINUTES = 15`
  - `hashPortalPassword(password: string): string` → `"<saltHex>:<hashHex>"`
  - `verifyPortalPassword(password: string, stored: string): boolean`
  - `interface PortalSession { rid: string; v: number; iat: number }`
  - `createPortalSession(data: { rid: string; v: number }, iat?: number): string`
  - `decodePortalSession(token: string, now?: number): PortalSession | null`
  - `validatePortalUsername(raw: unknown): string | null` (normalised lowercase or null)
  - `validatePortalPassword(raw: unknown): boolean`
  - Prisma `Retailer` fields `portalUsername`, `portalPasswordHash`, `portalEnabled`, `portalSessionVersion`, `portalFailedAttempts`, `portalLockedUntil`, `portalLastLoginAt`; `portalPasswordHash` is **omitted from every query unless explicitly `select`ed**.

- [ ] **Step 1: Write the failing unit test**

Create `tests/portal/portal-auth.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hashPortalPassword, verifyPortalPassword, createPortalSession, decodePortalSession,
  validatePortalUsername, validatePortalPassword,
} from '../../lib/utils/portal-auth'

test('password hash round-trips and is salted', () => {
  const a = hashPortalPassword('correct horse')
  const b = hashPortalPassword('correct horse')
  assert.notEqual(a, b)
  assert.ok(verifyPortalPassword('correct horse', a))
  assert.ok(verifyPortalPassword('correct horse', b))
  assert.ok(!verifyPortalPassword('wrong horse', a))
})

test('malformed stored hashes never verify', () => {
  for (const bad of ['', 'garbage', ':', 'zz:zz', 'abcd:']) {
    assert.equal(verifyPortalPassword('x', bad), false)
  }
})

test('session round-trips', () => {
  const token = createPortalSession({ rid: 'r1', v: 3 }, 1_000_000)
  assert.deepEqual(decodePortalSession(token, 1_000_000 + 1000), { rid: 'r1', v: 3, iat: 1_000_000 })
})

test('tampered or foreign-signed sessions are rejected', () => {
  const token = createPortalSession({ rid: 'r1', v: 0 }, Date.now())
  const [payload, sig] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ rid: 'other', v: 0, iat: Date.now() })).toString('base64url')
  assert.equal(decodePortalSession(`${forged}.${sig}`), null)
  assert.equal(decodePortalSession(`${payload}.${sig.slice(0, -2)}xx`), null)
  assert.equal(decodePortalSession('nodot'), null)
  assert.equal(decodePortalSession(''), null)
})

test('sessions expire after 7 days', () => {
  const iat = 5_000_000
  const token = createPortalSession({ rid: 'r1', v: 0 }, iat)
  assert.ok(decodePortalSession(token, iat + 6 * 86_400_000))
  assert.equal(decodePortalSession(token, iat + 8 * 86_400_000), null)
})

test('username validation normalises and rejects bad input', () => {
  assert.equal(validatePortalUsername('  Ali.Store '), 'ali.store')
  assert.equal(validatePortalUsername('abc'), 'abc')
  assert.equal(validatePortalUsername('ab'), null)
  assert.equal(validatePortalUsername('a b c'), null)
  assert.equal(validatePortalUsername('x'.repeat(33)), null)
  assert.equal(validatePortalUsername('bad/user'), null)
  assert.equal(validatePortalUsername(undefined), null)
  assert.equal(validatePortalUsername(12345), null)
})

test('password validation: 8–200 chars string', () => {
  assert.equal(validatePortalPassword('1234567'), false)
  assert.equal(validatePortalPassword('12345678'), true)
  assert.equal(validatePortalPassword('x'.repeat(201)), false)
  assert.equal(validatePortalPassword(null), false)
  assert.equal(validatePortalPassword(12345678), false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test tests/portal/portal-auth.test.ts`
Expected: FAIL — cannot find module `../../lib/utils/portal-auth`.

- [ ] **Step 3: Implement `lib/utils/portal-auth.ts`**

```ts
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

export const PORTAL_COOKIE = 'sp_customer'
export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 15
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const FALLBACK_SECRET = 'shelfpharma-erp-secret-2026' // same fallback the staff session uses

export const PORTAL_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_MS / 1000,
  secure: process.env.NODE_ENV === 'production',
}

const secret = () => process.env.AUTH_SECRET ?? FALLBACK_SECRET

// Stored as "<saltHex>:<hashHex>" — scrypt, per-user random salt.
export function hashPortalPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export function verifyPortalPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored ?? '').split(':')
  if (!saltHex || !hashHex || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export interface PortalSession { rid: string; v: number; iat: number }

export function createPortalSession(data: { rid: string; v: number }, iat: number = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ rid: data.rid, v: data.v, iat })).toString('base64url')
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function decodePortalSession(token: string, now: number = Date.now()): PortalSession | null {
  try {
    const dot = token.lastIndexOf('.')
    if (dot === -1) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    const expected = createHmac('sha256', secret()).update(payload).digest('base64url')
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as PortalSession
    if (typeof s.rid !== 'string' || typeof s.v !== 'number' || typeof s.iat !== 'number') return null
    if (now - s.iat > SESSION_MAX_AGE_MS) return null
    return s
  } catch {
    return null
  }
}

/** Lowercased, trimmed, 3–32 chars of [a-z0-9._-]; null when invalid. */
export function validatePortalUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const u = raw.trim().toLowerCase()
  return /^[a-z0-9._-]{3,32}$/.test(u) ? u : null
}

export function validatePortalPassword(raw: unknown): boolean {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 200
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx tsx --test tests/portal/portal-auth.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Production DB safety check, then additive schema change**

Run a row-count check (additive change, but confirm the table state and that the DB is reachable):

```bash
cat > qa-count.tmp.ts <<'EOF'
import 'dotenv/config'
import { prisma } from './lib/prisma'
async function main() { console.log({ retailers: await prisma.retailer.count() }); await prisma.$disconnect() }
main()
EOF
npx tsx qa-count.tmp.ts; rm -f qa-count.tmp.ts
```

Edit `prisma/schema.prisma`: inside `model Retailer`, directly above the line `salesReturns      SalesReturn[]` (spacing may differ after `prisma format`) add:

```prisma
  // Customer portal login (set by staff; customers cannot change it). portalPasswordHash is omitted
  // from all queries by default — see lib/prisma.ts.
  portalUsername       String?   @unique
  portalPasswordHash   String?
  portalEnabled        Boolean   @default(false)
  portalSessionVersion Int       @default(0)
  portalFailedAttempts Int       @default(0)
  portalLockedUntil    DateTime?
  portalLastLoginAt    DateTime?
```

Run: `npx prisma db push` then `npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema." (no data-loss warning; if Prisma asks for `--accept-data-loss`, STOP — something is not additive.)

- [ ] **Step 6: Make the hash invisible by default (global omit)**

Replace `lib/prisma.ts` with:

```ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  return new PrismaClient({
    adapter,
    // The customer-portal password hash must never leak through `include: { retailer: true }` etc.
    // Code that needs it (portal login, staff credential management) must `select` it explicitly.
    omit: { retailer: { portalPasswordHash: true } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof createClient> }

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 7: Verify type-check and that omit works with explicit select**

```bash
npx tsc --noEmit
cat > qa-omit.tmp.ts <<'EOF'
import 'dotenv/config'
import { prisma } from './lib/prisma'
import { hashPortalPassword } from './lib/utils/portal-auth'
async function main() {
  const r = await prisma.retailer.create({ data: { name: 'QA Omit Test', portalUsername: 'qa-omit-test', portalPasswordHash: hashPortalPassword('password1') } })
  try {
    const plain = await prisma.retailer.findUnique({ where: { id: r.id } })
    const withRel = await prisma.order.findMany({ where: { retailerId: r.id }, include: { retailer: true } })
    const explicit = await prisma.retailer.findUnique({ where: { id: r.id }, select: { portalPasswordHash: true } })
    console.log('plain has hash key:', plain && 'portalPasswordHash' in plain, '| created obj has hash key:', 'portalPasswordHash' in r)
    console.log('explicit select returns hash:', !!explicit?.portalPasswordHash, withRel.length)
  } finally {
    await prisma.retailer.delete({ where: { id: r.id } })
    await prisma.$disconnect()
  }
}
main()
EOF
npx tsx qa-omit.tmp.ts; rm -f qa-omit.tmp.ts
```
Expected: `tsc` clean; output `plain has hash key: false | created obj has hash key: false` and `explicit select returns hash: true 0`. If `tsc` reports errors about `ReturnType<typeof createClient>`, fix the type alias rather than removing `omit`.

---

### Task 2: Session helper, login/logout/me APIs, middleware exemption

**Files:**
- Create: `lib/portal/session.ts`, `app/api/portal/login/route.ts`, `app/api/portal/logout/route.ts`, `app/api/portal/me/route.ts`, `tests/portal/qa-helpers.ts`, `tests/portal/qa-auth.ts`
- Modify: `middleware.ts` (exempt `/api/portal/` AND verify the staff cookie signature — see Step 4)

**Interfaces:**
- Consumes (Task 1): `PORTAL_COOKIE`, `PORTAL_COOKIE_OPTIONS`, `MAX_FAILED_ATTEMPTS`, `LOCK_MINUTES`, `hashPortalPassword`, `verifyPortalPassword`, `createPortalSession`, `decodePortalSession`, `validatePortalUsername`.
- Produces:
  - `interface PortalCustomer { id: string; name: string; customerType: string | null; salesRepId: string | null; area: { name: string; deliveryDays: number[]; bookingDays: BookingDay[] } | null }`
  - `getPortalCustomer(token: string | undefined): Promise<PortalCustomer | null>`
  - `getPortalCustomerFromRequest(req: NextRequest): Promise<PortalCustomer | null>`
  - `POST /api/portal/login` `{ username, password }` → 200 `{ success: true }` + `sp_customer` cookie | 401 `{ error: 'Invalid username or password' }` | 429 `{ error: 'Too many attempts, try again later' }`
  - `POST /api/portal/logout` → 200, clears cookie
  - `GET /api/portal/me` → 200 `{ data: { name, deliveryDays, bookingDays } }` | 401 (Task 4 adds `nextBooking`)
  - Test helpers in `tests/portal/qa-helpers.ts` (exact exports listed in Step 1).

- [ ] **Step 1: Write the integration test helpers and the failing auth script**

Create `tests/portal/qa-helpers.ts`:

```ts
import 'dotenv/config'
import { createHmac } from 'crypto'
import { prisma } from '../../lib/prisma'
import { hashPortalPassword } from '../../lib/utils/portal-auth'

export { prisma }
export const BASE = 'http://localhost:3100'
export const QA_PASSWORD = 'qa-password-1'

export function staffCookie(role = 'ADMIN'): string {
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret-2026'
  const payload = Buffer.from(JSON.stringify({ id: 'qa', name: 'QA', role })).toString('base64url')
  return `sp_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

export function check(name: string, ok: boolean, extra = '') {
  console.log(ok ? 'PASS' : 'FAIL', name, extra)
  if (!ok) process.exitCode = 1
}

let counter = 0
export async function makeQaCustomer(opts: { customerType?: string | null; areaId?: string; username?: string; enabled?: boolean } = {}) {
  const username = opts.username ?? `qa-portal-${Date.now()}-${counter++}`
  const retailer = await prisma.retailer.create({
    data: {
      name: 'QA Portal Customer',
      customerType: opts.customerType === undefined ? 'QA-Type' : opts.customerType,
      areaId: opts.areaId,
      portalUsername: username,
      portalPasswordHash: hashPortalPassword(QA_PASSWORD),
      portalEnabled: opts.enabled ?? true,
    },
  })
  return { retailer, username, password: QA_PASSWORD }
}

export async function portalLogin(username: string, password: string) {
  const res = await fetch(`${BASE}/api/portal/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const m = /sp_customer=([^;]*)/.exec(setCookie)
  return { res, cookie: m && m[1] ? `sp_customer=${m[1]}` : null }
}

export const api = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) } })

/** Deletes everything a QA run may have created. Safe to call repeatedly. */
export async function cleanupQa() {
  const qaRetailers = await prisma.retailer.findMany({ where: { name: { startsWith: 'QA ' } }, select: { id: true } })
  const rids = qaRetailers.map(r => r.id)
  const orders = await prisma.order.findMany({ where: { retailerId: { in: rids } }, select: { id: true } })
  const oids = orders.map(o => o.id)
  await prisma.deliveryChallan.deleteMany({ where: { orderId: { in: oids } } })
  await prisma.delivery.deleteMany({ where: { orderId: { in: oids } } })
  await prisma.payment.deleteMany({ where: { retailerId: { in: rids } } })
  await prisma.invoice.deleteMany({ where: { orderId: { in: oids } } })
  await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
  await prisma.order.deleteMany({ where: { id: { in: oids } } })
  await prisma.offerListCustomer.deleteMany({ where: { retailerId: { in: rids } } }) // items cascade
  await prisma.offerListAssignment.deleteMany({ where: { customerType: { startsWith: 'QA' } } })
  await prisma.offerListItem.deleteMany({ where: { medicine: { code: { startsWith: 'QA' } } } })
  await prisma.offerList.deleteMany({ where: { listNumber: { startsWith: 'QA' } } })
  await prisma.medicineBatch.deleteMany({ where: { medicine: { code: { startsWith: 'QA' } } } })
  await prisma.medicine.deleteMany({ where: { code: { startsWith: 'QA' } } })
  await prisma.retailer.deleteMany({ where: { id: { in: rids } } })
  await prisma.area.deleteMany({ where: { name: { startsWith: 'QA ' } } })
  await prisma.employee.deleteMany({ where: { name: { startsWith: 'QA ' } } })
}
```

Create `tests/portal/qa-auth.ts`:

```ts
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
    check('logout 200 clears cookie', out.status === 200 && /sp_customer=;|sp_customer=($|,)/.test(out.headers.get('set-cookie') ?? '') || /Max-Age=0/i.test(out.headers.get('set-cookie') ?? ''))
    void QA_PASSWORD
  } finally {
    await cleanupQa()
    console.log('cleanup done')
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run it to verify it fails**

Start the dev server in the background: `npx next dev -p 3100` (wait until "Ready"). Run: `npx tsx tests/portal/qa-auth.ts`
Expected: FAIL — first request to `/api/portal/login` returns 401 (middleware: no `sp_session`) or 404; script prints FAIL lines. Cleanup still runs.

- [ ] **Step 3: Implement `lib/portal/session.ts`**

```ts
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PORTAL_COOKIE, decodePortalSession } from '@/lib/utils/portal-auth'
import type { BookingDay } from '@/lib/utils/area-schedule'

export interface PortalCustomer {
  id: string
  name: string
  customerType: string | null
  salesRepId: string | null
  area: { name: string; deliveryDays: number[]; bookingDays: BookingDay[] } | null
}

/** Verifies the cookie AND re-checks the account on every request, so disabling/deactivating/resetting takes effect immediately. */
export async function getPortalCustomer(token: string | undefined): Promise<PortalCustomer | null> {
  if (!token) return null
  const session = decodePortalSession(token)
  if (!session) return null

  const r = await prisma.retailer.findUnique({
    where: { id: session.rid },
    select: {
      id: true, name: true, customerType: true, salesRepId: true,
      isActive: true, portalEnabled: true, portalSessionVersion: true,
      area: { select: { name: true, deliveryDays: true, bookingDays: true } },
    },
  })
  if (!r || !r.isActive || !r.portalEnabled || r.portalSessionVersion !== session.v) return null

  return {
    id: r.id,
    name: r.name,
    customerType: r.customerType,
    salesRepId: r.salesRepId,
    area: r.area
      ? { name: r.area.name, deliveryDays: r.area.deliveryDays, bookingDays: (r.area.bookingDays as BookingDay[] | null) ?? [] }
      : null,
  }
}

export const getPortalCustomerFromRequest = (req: NextRequest) =>
  getPortalCustomer(req.cookies.get(PORTAL_COOKIE)?.value)
```

- [ ] **Step 4: Implement login, logout, me, and the middleware exemption**

`app/api/portal/login/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  PORTAL_COOKIE, PORTAL_COOKIE_OPTIONS, MAX_FAILED_ATTEMPTS, LOCK_MINUTES,
  hashPortalPassword, verifyPortalPassword, createPortalSession, validatePortalUsername,
} from '@/lib/utils/portal-auth'

export const dynamic = 'force-dynamic'

// Verified against when the account is unknown/unusable so response time does not reveal which usernames exist.
const DUMMY_HASH = hashPortalPassword('dummy-password-for-timing')

const invalid = () => NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
const tooMany = () => NextResponse.json({ error: 'Too many attempts, try again later' }, { status: 429 })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const username = validatePortalUsername(body?.username)
  const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : ''

  const r = username
    ? await prisma.retailer.findUnique({
        where: { portalUsername: username },
        select: {
          id: true, isActive: true, portalEnabled: true, portalPasswordHash: true,
          portalSessionVersion: true, portalLockedUntil: true,
        },
      })
    : null

  if (r?.portalLockedUntil && r.portalLockedUntil > new Date()) return tooMany()

  const usable = !!r && r.isActive && r.portalEnabled && !!r.portalPasswordHash
  const ok = verifyPortalPassword(password, usable ? r!.portalPasswordHash! : DUMMY_HASH)

  if (!usable || !ok) {
    // Only count failures against real, usable accounts
    if (r && usable) {
      const upd = await prisma.retailer.update({
        where: { id: r.id },
        data: { portalFailedAttempts: { increment: 1 } },
        select: { portalFailedAttempts: true },
      })
      if (upd.portalFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        await prisma.retailer.update({
          where: { id: r.id },
          data: { portalFailedAttempts: 0, portalLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
        })
        return tooMany()
      }
    }
    return invalid()
  }

  await prisma.retailer.update({
    where: { id: r!.id },
    data: { portalFailedAttempts: 0, portalLockedUntil: null, portalLastLoginAt: new Date() },
  })

  const res = NextResponse.json({ success: true })
  res.cookies.set(PORTAL_COOKIE, createPortalSession({ rid: r!.id, v: r!.portalSessionVersion }), PORTAL_COOKIE_OPTIONS)
  return res
}
```

`app/api/portal/logout/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { PORTAL_COOKIE } from '@/lib/utils/portal-auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const res = NextResponse.json({ success: true })
  res.cookies.set(PORTAL_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
```

`app/api/portal/me/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getPortalCustomerFromRequest } from '@/lib/portal/session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    data: {
      name: customer.name,
      deliveryDays: customer.area?.deliveryDays ?? [],
      bookingDays: customer.area?.bookingDays ?? [],
    },
  })
}
```

Replace `middleware.ts` entirely. It previously only checked that an `sp_session` cookie *existed* (any value passed — `Cookie: sp_session=garbage` returned real data from `/api/retailers`; a pre-existing hole the user approved fixing here). It now verifies the cookie's HMAC signature and payload shape on every `/api/*` call (Edge runtime: Web Crypto, constant-time `subtle.verify`), and exempts `/api/portal/` (those routes authenticate the separate customer cookie themselves):

```ts
import { NextRequest, NextResponse } from 'next/server'

const COOKIE = 'sp_session'
// /api/portal/* is exempt from the staff-cookie check: every portal route authenticates the separate customer
// cookie itself (lib/portal/session.ts). Customers never hold a valid sp_session, so all other /api/* is 401 for them.
const PUBLIC_API = ['/api/auth/login', '/api/auth/logout', '/api/whatsapp/webhook', '/api/portal/']
const FALLBACK_SECRET = 'shelfpharma-erp-secret-2026' // same fallback as lib/utils/auth.ts and the (erp) layout

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** True only for a cookie signed with AUTH_SECRET whose payload looks like a staff session ({ id, role } strings). */
async function isValidStaffSession(token: string): Promise<boolean> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot < 1) return false
    const payload = token.slice(0, dot)
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(process.env.AUTH_SECRET ?? FALLBACK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    )
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(token.slice(dot + 1)), new TextEncoder().encode(payload))
    if (!ok) return false
    const s = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)))
    return typeof s?.id === 'string' && typeof s?.role === 'string'
  } catch {
    return false
  }
}

// Page auth is handled by the (erp) server component layout; this guards API routes.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!pathname.startsWith('/api/')) return NextResponse.next()
  if (PUBLIC_API.some(p => pathname.startsWith(p))) return NextResponse.next()

  const token = req.cookies.get(COOKIE)?.value
  if (!token || !(await isValidStaffSession(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
```

- [ ] **Step 5: Run the integration script to verify it passes**

Run: `npx tsc --noEmit` (expected: clean), then `npx tsx tests/portal/qa-auth.ts` (dev server still running; it hot-reloads).
Expected: every line `PASS`, `cleanup done`, exit code 0. Note: `staff cookie -> /api/portal/me 401` must PASS (staff cookie is not a customer session).

---

### Task 3: Cart validation and pricing (pure logic)

**Files:**
- Create: `lib/portal/pricing.ts`, `tests/portal/pricing.test.ts`

**Interfaces:**
- Produces (used by Tasks 4–6):
  - `interface ServerOfferItem { medicineId: string; code: string; name: string; manufacturer: string; unitPrice: number; offerPercent: number; comment: string; salesTax: number; salesTaxApplicable: boolean; mrp: number | null }`
  - `interface PortalOfferItem { medicineId: string; code: string; name: string; manufacturer: string; unitPrice: number; offerPercent: number; comment: string }`
  - `toPublicItem(i: ServerOfferItem): PortalOfferItem`
  - `interface PricedLine { medicineId: string; quantity: number; mrp: number | null; unitPrice: number; offerPercent: number; salesTax: number; salesTaxAmount: number; lineTotal: number }`
  - `priceLine(item: ServerOfferItem, quantity: number): PricedLine`
  - `type CartResult = { ok: true; lines: { medicineId: string; quantity: number }[] } | { ok: false; error: string }`
  - `sanitizeCart(raw: unknown): CartResult` (drops quantity-0 lines; may return `lines: []`)
  - `buildPricedLines(cart: { medicineId: string; quantity: number }[], offers: Map<string, ServerOfferItem>): { ok: true; lines: PricedLine[]; total: number } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing unit test**

Create `tests/portal/pricing.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { toPublicItem, priceLine, sanitizeCart, buildPricedLines, type ServerOfferItem } from '../../lib/portal/pricing'

const item = (over: Partial<ServerOfferItem> = {}): ServerOfferItem => ({
  medicineId: 'm1', code: '000001', name: 'ABOCAL TAB', manufacturer: 'ABBOTT', unitPrice: 100, offerPercent: 10,
  comment: '—', salesTax: 5, salesTaxApplicable: true, mrp: 120, ...over,
})

test('toPublicItem exposes only the whitelisted fields', () => {
  const leaky = { ...item(), purchasePercent: 12, purchasePrice: 70, currentQty: 50, batches: [] } as unknown as ServerOfferItem
  assert.deepEqual(Object.keys(toPublicItem(leaky)).sort(),
    ['code', 'comment', 'manufacturer', 'medicineId', 'name', 'offerPercent', 'unitPrice'])
})

test('priceLine mirrors staff order math (tax excluded from lineTotal)', () => {
  const l = priceLine(item(), 3)
  assert.equal(l.lineTotal, 270)
  assert.equal(l.salesTax, 5)
  assert.equal(l.salesTaxAmount, 15)
  assert.equal(l.mrp, 120)
})

test('sales tax is zero when the medicine is not tax-applicable', () => {
  const l = priceLine(item({ salesTaxApplicable: false }), 3)
  assert.equal(l.salesTax, 0)
  assert.equal(l.salesTaxAmount, 0)
})

test('lineTotal is rounded to 2 decimals', () => {
  assert.equal(priceLine(item({ unitPrice: 33.33, offerPercent: 15 }), 3).lineTotal, 84.99)
})

test('sanitizeCart accepts whole quantities 0..9999 and drops zeros', () => {
  const r = sanitizeCart([{ medicineId: 'a', quantity: 2 }, { medicineId: 'b', quantity: 0 }, { medicineId: 'c', quantity: 9999 }])
  assert.deepEqual(r, { ok: true, lines: [{ medicineId: 'a', quantity: 2 }, { medicineId: 'c', quantity: 9999 }] })
  assert.deepEqual(sanitizeCart([]), { ok: true, lines: [] })
})

test('sanitizeCart rejects tampered input', () => {
  const bad: unknown[] = [
    undefined, null, 'x', {},
    [{ medicineId: 'a', quantity: 1.5 }],
    [{ medicineId: 'a', quantity: -1 }],
    [{ medicineId: 'a', quantity: 10000 }],
    [{ medicineId: 'a', quantity: '5' }],
    [{ medicineId: 'a', quantity: NaN }],
    [{ medicineId: '', quantity: 1 }],
    [{ quantity: 1 }],
    [null],
    [{ medicineId: 'a', quantity: 1 }, { medicineId: 'a', quantity: 2 }],
    Array.from({ length: 1001 }, (_, i) => ({ medicineId: `m${i}`, quantity: 1 })),
  ]
  for (const b of bad) assert.equal((sanitizeCart(b) as { ok: boolean }).ok, false, JSON.stringify(b)?.slice(0, 60))
})

test('buildPricedLines prices server-side and totals; ignores client price fields', () => {
  const offers = new Map([['m1', item()], ['m2', item({ medicineId: 'm2', unitPrice: 50, offerPercent: 0, salesTaxApplicable: false })]])
  const cart = [{ medicineId: 'm1', quantity: 3, unitPrice: 0.01 }, { medicineId: 'm2', quantity: 2 }] as { medicineId: string; quantity: number }[]
  const r = buildPricedLines(cart, offers)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.lines[0].unitPrice, 100)
    assert.equal(r.total, 370) // 270 + 100
  }
})

test('buildPricedLines rejects an item that is not on the customer offer list', () => {
  const r = buildPricedLines([{ medicineId: 'foreign', quantity: 1 }], new Map([['m1', item()]]))
  assert.deepEqual(r, { ok: false, error: 'An item in your order is not on your offer list' })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test tests/portal/pricing.test.ts`
Expected: FAIL — cannot find module `../../lib/portal/pricing`.

- [ ] **Step 3: Implement `lib/portal/pricing.ts`**

```ts
// Pure (no DB) so it can be unit-tested. Everything the browser may see or send passes through here.

export interface ServerOfferItem {
  medicineId: string
  code: string
  name: string
  manufacturer: string
  unitPrice: number          // specialPrice ?? FEFO batch trade price
  offerPercent: number
  comment: string            // formatOfferComment(...)
  salesTax: number           // flat Rs per unit (only applied if salesTaxApplicable)
  salesTaxApplicable: boolean
  mrp: number | null         // FEFO batch MRP snapshot
}

export interface PortalOfferItem {
  medicineId: string
  code: string
  name: string
  manufacturer: string
  unitPrice: number
  offerPercent: number
  comment: string
}

/** Explicit whitelist — never spread the server item (it is the only place cost/stock-derived data could leak). */
export function toPublicItem(i: ServerOfferItem): PortalOfferItem {
  return {
    medicineId: i.medicineId,
    code: i.code,
    name: i.name,
    manufacturer: i.manufacturer,
    unitPrice: i.unitPrice,
    offerPercent: i.offerPercent,
    comment: i.comment,
  }
}

export interface PricedLine {
  medicineId: string
  quantity: number
  mrp: number | null
  unitPrice: number
  offerPercent: number
  salesTax: number
  salesTaxAmount: number
  lineTotal: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function priceLine(item: ServerOfferItem, quantity: number): PricedLine {
  const salesTax = item.salesTaxApplicable ? item.salesTax : 0
  return {
    medicineId: item.medicineId,
    quantity,
    mrp: item.mrp,
    unitPrice: item.unitPrice,
    offerPercent: item.offerPercent,
    salesTax,
    salesTaxAmount: round2(salesTax * quantity),
    lineTotal: round2(quantity * item.unitPrice * (1 - item.offerPercent / 100)),
  }
}

export type CartResult =
  | { ok: true; lines: { medicineId: string; quantity: number }[] }
  | { ok: false; error: string }

const MAX_QTY = 9999
const MAX_LINES = 1000

/** Validates the browser-supplied cart. Prices/other fields in the payload are never read. */
export function sanitizeCart(raw: unknown): CartResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'items must be a list' }
  if (raw.length > MAX_LINES) return { ok: false, error: 'Too many items in one order' }
  const seen = new Set<string>()
  const lines: { medicineId: string; quantity: number }[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') return { ok: false, error: 'Invalid item' }
    const { medicineId, quantity } = row as { medicineId?: unknown; quantity?: unknown }
    if (typeof medicineId !== 'string' || medicineId === '') return { ok: false, error: 'Invalid item' }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY) {
      return { ok: false, error: `Quantity must be a whole number between 0 and ${MAX_QTY}` }
    }
    if (seen.has(medicineId)) return { ok: false, error: 'The same item appears twice' }
    seen.add(medicineId)
    if (quantity > 0) lines.push({ medicineId, quantity })
  }
  return { ok: true, lines }
}

export function buildPricedLines(
  cart: { medicineId: string; quantity: number }[],
  offers: Map<string, ServerOfferItem>,
): { ok: true; lines: PricedLine[]; total: number } | { ok: false; error: string } {
  const lines: PricedLine[] = []
  for (const c of cart) {
    const offer = offers.get(c.medicineId)
    if (!offer) return { ok: false, error: 'An item in your order is not on your offer list' }
    lines.push(priceLine(offer, c.quantity))
  }
  return { ok: true, lines, total: round2(lines.reduce((s, l) => s + l.lineTotal, 0)) }
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx tsx --test tests/portal/pricing.test.ts` → PASS (8 tests). Then `npx tsc --noEmit` → clean.

---

### Task 4: Offer-list resolution, booking cut-off, `/me` + `/offer-list` APIs

**Files:**
- Create: `lib/portal/offer-list.ts`, `app/api/portal/offer-list/route.ts`, `tests/portal/schedule.test.ts`, `tests/portal/qa-offer.ts`
- Modify: `lib/utils/area-schedule.ts` (append `nextBookingCutoff`), `app/api/portal/me/route.ts` (add `nextBooking`), `tests/portal/qa-helpers.ts` (append `ensureQaOffer`)

**Interfaces:**
- Consumes: `PortalCustomer` (Task 2), `ServerOfferItem`/`PortalOfferItem`/`toPublicItem` (Task 3), `BookingDay` (existing in `lib/utils/area-schedule.ts`).
- Produces:
  - `interface NextBooking { day: number; cutoffHour: number; isToday: boolean }`; `nextBookingCutoff(bookingDays: BookingDay[], now?: Date): NextBooking | null`
  - `resolveOfferListId(customer: { id: string; customerType: string | null }): Promise<string | null>`
  - `loadOfferItems(listId: string): Promise<ServerOfferItem[]>` (sorted by manufacturer, then name; items with no price are omitted)
  - `GET /api/portal/offer-list` → `{ data: { listNumber: string; items: PortalOfferItem[] } | null }`
  - `GET /api/portal/me` → `{ data: { name, deliveryDays, bookingDays, nextBooking: NextBooking | null } }`
  - Test helper `ensureQaOffer(): Promise<{ listId: string; medicineId: string; createdList: boolean }>`

- [ ] **Step 1: Write the failing booking-cut-off test**

Create `tests/portal/schedule.test.ts` (Karachi is UTC+5, no DST; 2026-10-11 is a Sunday):

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextBookingCutoff } from '../../lib/utils/area-schedule'

const sun10am = new Date('2026-10-11T05:00:00Z') // Sunday 10:00 Karachi
const sun6pm = new Date('2026-10-11T13:00:00Z')  // Sunday 18:00 Karachi
const sat1130pm = new Date('2026-10-10T18:30:00Z') // Saturday 23:30 Karachi

test('no booking days -> null', () => {
  assert.equal(nextBookingCutoff([], sun10am), null)
})

test('today is a booking day and the cut-off has not passed', () => {
  assert.deepEqual(nextBookingCutoff([{ day: 0, cutoffHour: 17 }], sun10am), { day: 0, cutoffHour: 17, isToday: true })
})

test('cut-off passed -> same weekday next week when it is the only booking day', () => {
  assert.deepEqual(nextBookingCutoff([{ day: 0, cutoffHour: 17 }], sun6pm), { day: 0, cutoffHour: 17, isToday: false })
})

test('cut-off passed -> next configured booking day', () => {
  assert.deepEqual(nextBookingCutoff([{ day: 0, cutoffHour: 17 }, { day: 1, cutoffHour: 9 }], sun6pm), { day: 1, cutoffHour: 9, isToday: false })
})

test('hour 0 cut-off tomorrow is not today', () => {
  assert.deepEqual(nextBookingCutoff([{ day: 0, cutoffHour: 0 }], sat1130pm), { day: 0, cutoffHour: 0, isToday: false })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test tests/portal/schedule.test.ts`
Expected: FAIL — `nextBookingCutoff` is not exported.

- [ ] **Step 3: Implement `nextBookingCutoff`**

Append to `lib/utils/area-schedule.ts`:

```ts
export interface NextBooking { day: number; cutoffHour: number; isToday: boolean }

/** The next upcoming booking cut-off, using the Asia/Karachi clock. Null when the area has no booking days. */
export function nextBookingCutoff(bookingDays: BookingDay[], now: Date = new Date()): NextBooking | null {
  if (!bookingDays.length) return null
  const k = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  for (let ahead = 0; ahead <= 7; ahead++) {
    const dayIdx = (k.getDay() + ahead) % 7
    const b = bookingDays.find(x => x.day === dayIdx)
    if (!b) continue
    if (ahead > 0) return { day: b.day, cutoffHour: b.cutoffHour, isToday: false }
    const cutoff = new Date(k)
    cutoff.setHours(b.cutoffHour, 0, 0, 0)
    if (cutoff > k) return { day: b.day, cutoffHour: b.cutoffHour, isToday: true }
  }
  return null
}
```

Run: `npx tsx --test tests/portal/schedule.test.ts` → PASS (5 tests).

- [ ] **Step 4: Implement offer-list resolution and the APIs**

`lib/portal/offer-list.ts`:

```ts
import { prisma } from '@/lib/prisma'
import { getFefoBatch } from '@/lib/utils/pricing'
import { formatOfferComment } from '@/lib/utils/offer-comment'
import type { ServerOfferItem } from '@/lib/portal/pricing'

/** The active offer list, if this customer is entitled to it (individual sheet, or their Customer Type is assigned). */
export async function resolveOfferListId(customer: { id: string; customerType: string | null }): Promise<string | null> {
  const list = await prisma.offerList.findFirst({ where: { isActive: true }, select: { id: true } })
  if (!list) return null

  const sheet = await prisma.offerListCustomer.findUnique({
    where: { offerListId_retailerId: { offerListId: list.id, retailerId: customer.id } },
    select: { id: true },
  })
  if (sheet) return list.id

  if (customer.customerType) {
    const assignment = await prisma.offerListAssignment.findUnique({
      where: { offerListId_customerType: { offerListId: list.id, customerType: customer.customerType } },
      select: { id: true },
    })
    if (assignment) return list.id
  }
  return null
}

const expiryToMMYY = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`

export async function loadOfferItems(listId: string): Promise<ServerOfferItem[]> {
  const items = await prisma.offerListItem.findMany({
    where: { offerListId: listId },
    include: {
      medicine: {
        select: {
          code: true, name: true, salesTaxApplicable: true,
          manufacturer: { select: { name: true } },
          batches: { select: { expiryDate: true, currentQty: true, tradePrice: true, mrp: true } },
        },
      },
    },
  })

  const out: ServerOfferItem[] = []
  for (const item of items) {
    const fefo = getFefoBatch(item.medicine.batches)
    const unitPrice = item.specialPrice != null ? Number(item.specialPrice) : fefo ? Number(fefo.tradePrice) : null
    if (unitPrice === null) continue // nothing to charge — hide rather than sell at 0
    out.push({
      medicineId: item.medicineId,
      code: item.medicine.code,
      name: item.medicine.name,
      manufacturer: item.medicine.manufacturer?.name ?? '',
      unitPrice,
      offerPercent: Number(item.offerPercent),
      comment: formatOfferComment(item, fefo ? expiryToMMYY(new Date(fefo.expiryDate)) : null),
      salesTax: Number(item.salesTax),
      salesTaxApplicable: item.medicine.salesTaxApplicable,
      mrp: fefo?.mrp != null ? Number(fefo.mrp) : null,
    })
  }
  return out.sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name))
}
```

`app/api/portal/offer-list/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPortalCustomerFromRequest } from '@/lib/portal/session'
import { resolveOfferListId, loadOfferItems } from '@/lib/portal/offer-list'
import { toPublicItem } from '@/lib/portal/pricing'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const listId = await resolveOfferListId(customer)
  if (!listId) return NextResponse.json({ data: null })

  const [list, items] = await Promise.all([
    prisma.offerList.findUnique({ where: { id: listId }, select: { listNumber: true } }),
    loadOfferItems(listId),
  ])
  return NextResponse.json({ data: { listNumber: list?.listNumber ?? '', items: items.map(toPublicItem) } })
}
```

Update `app/api/portal/me/route.ts` to add the cut-off:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getPortalCustomerFromRequest } from '@/lib/portal/session'
import { nextBookingCutoff } from '@/lib/utils/area-schedule'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const bookingDays = customer.area?.bookingDays ?? []
  return NextResponse.json({
    data: {
      name: customer.name,
      deliveryDays: customer.area?.deliveryDays ?? [],
      bookingDays,
      nextBooking: nextBookingCutoff(bookingDays),
    },
  })
}
```

- [ ] **Step 5: Add the QA offer helper and the integration script**

Append to `tests/portal/qa-helpers.ts`:

```ts
/**
 * Gives tests a priced offer item without disturbing real data: a QA medicine (T.P. 100, FEFO batch, 10% offer) is added
 * to the REAL active list if one exists; only when no list is active is a QA list created (and made active).
 * A QA list is never activated while a real one exists. cleanupQa() removes all of it.
 */
export async function ensureQaOffer() {
  const mfr = await prisma.manufacturer.findFirst({ select: { id: true } })
  if (!mfr) throw new Error('no manufacturer in DB')
  const code = `QA${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`
  const med = await prisma.medicine.create({ data: { code, name: `QA PORTAL ITEM ${code}`, manufacturerId: mfr.id, salesTaxApplicable: false } })
  await prisma.medicineBatch.create({
    data: { medicineId: med.id, batchNumber: 'QA-B1', expiryDate: new Date('2030-06-01'), quantityIn: 50, currentQty: 50, purchasePrice: 60, tradePrice: 100, mrp: 130 },
  })
  let list = await prisma.offerList.findFirst({ where: { isActive: true } })
  let createdList = false
  if (!list) {
    list = await prisma.offerList.create({ data: { listNumber: `QA${Date.now()}`, listDate: new Date(), isActive: true } })
    createdList = true
  }
  await prisma.offerListItem.create({ data: { offerListId: list.id, medicineId: med.id, offerPercent: 10, salesTax: 0 } })
  return { listId: list.id, medicineId: med.id, createdList }
}
```

Create `tests/portal/qa-offer.ts`:

```ts
import { prisma, check, makeQaCustomer, portalLogin, api, ensureQaOffer, cleanupQa } from './qa-helpers'

async function main() {
  try {
    const offer = await ensureQaOffer()
    const area = await prisma.area.create({ data: { name: 'QA Portal Area', deliveryDays: [1, 2], bookingDays: [{ day: 0, cutoffHour: 17 }] } })

    // 1. entitled via individual sheet
    const a = await makeQaCustomer({ customerType: 'QA-NoSuchType', areaId: area.id })
    await prisma.offerListCustomer.create({ data: { offerListId: offer.listId, retailerId: a.retailer.id } })
    const ca = (await portalLogin(a.username, a.password)).cookie!
    let j = await (await api('/api/portal/offer-list', ca)).json()
    const row = j.data?.items.find((i: { medicineId: string }) => i.medicineId === offer.medicineId)
    check('sheet customer sees the QA item at T.P. 100 / 10%', !!row && row.unitPrice === 100 && row.offerPercent === 10, JSON.stringify(row))
    const raw = JSON.stringify(j)
    check('no cost/stock fields in the payload', !/purchase|currentQty|batches|quantityIn|salesTax|mrp/i.test(raw))
    check('list sorted by manufacturer then name', j.data.items.every((it: { manufacturer: string; name: string }, i: number, arr: { manufacturer: string; name: string }[]) =>
      i === 0 || arr[i - 1].manufacturer.localeCompare(it.manufacturer) < 0 || (arr[i - 1].manufacturer === it.manufacturer && arr[i - 1].name.localeCompare(it.name) <= 0)))

    // 2. /me carries the area schedule
    const me = await (await api('/api/portal/me', ca)).json()
    check('/me delivery days [1,2] + booking cut-off', me.data.deliveryDays.join() === '1,2' && me.data.nextBooking?.day === 0 && me.data.nextBooking?.cutoffHour === 17, JSON.stringify(me.data))

    // 3. entitled via Customer Type assignment (no sheet), sparse data (no area)
    const b = await makeQaCustomer({ customerType: 'QA-Type-Assigned' })
    await prisma.offerListAssignment.create({ data: { offerListId: offer.listId, customerType: 'QA-Type-Assigned' } })
    const cb = (await portalLogin(b.username, b.password)).cookie!
    j = await (await api('/api/portal/offer-list', cb)).json()
    check('type-assigned customer resolves the list', j.data?.items.some((i: { medicineId: string }) => i.medicineId === offer.medicineId))
    const meB = await (await api('/api/portal/me', cb)).json()
    check('no-area customer: empty days, null cut-off', meB.data.deliveryDays.length === 0 && meB.data.nextBooking === null)

    // 4. not entitled / null customerType -> data: null, no crash
    const c = await makeQaCustomer({ customerType: 'QA-Unassigned-Type' })
    const cc = (await portalLogin(c.username, c.password)).cookie!
    j = await (await api('/api/portal/offer-list', cc)).json()
    check('unentitled customer -> data null', j.data === null)
    const d = await makeQaCustomer({ customerType: null })
    const cd = (await portalLogin(d.username, d.password)).cookie!
    check('null customerType -> 200, data null', (await api('/api/portal/offer-list', cd)).status === 200)

    // 5. unauthenticated
    check('offer-list without cookie -> 401', (await fetch('http://localhost:3100/api/portal/offer-list')).status === 401)
  } finally {
    await cleanupQa()
    console.log('cleanup done')
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
```

Note on test (1): if the real active list already assigns `QA-NoSuchType`'s type there is no conflict — the type string is unique to this test.

- [ ] **Step 6: Run to verify**

Run: `npx tsc --noEmit` (clean), then with the dev server running `npx tsx tests/portal/qa-offer.ts`.
Expected: all `PASS`, `cleanup done`. Afterwards confirm no residue: `npx tsx -e "import('./tests/portal/qa-helpers').then(async m => { console.log(await m.prisma.medicine.count({ where: { code: { startsWith: 'QA' } } }), await m.prisma.offerList.count({ where: { listNumber: { startsWith: 'QA' } } })); await m.prisma.\$disconnect() })"` → `0 0`.

---

### Task 5: Staff-side portal credential management (API + customer-page card)

**Files:**
- Create: `app/api/retailers/[id]/portal/route.ts`, `components/retailers/PortalAccessCard.tsx`, `tests/portal/qa-staff.ts`
- Modify: `app/(erp)/retailers/[id]/page.tsx` (import + mount the card)

**Interfaces:**
- Consumes: Task 1 (`validatePortalUsername`, `validatePortalPassword`, `hashPortalPassword`), `getUserFromRequest` (`lib/utils/auth.ts`).
- Produces:
  - `GET /api/retailers/[id]/portal` → `{ data: { portalUsername: string | null; portalEnabled: boolean; hasPassword: boolean; portalLastLoginAt: string | null; lockedUntil: string | null } }` (ADMIN/MANAGER only, else 403; never returns the hash)
  - `PUT /api/retailers/[id]/portal` body `{ username?: string, password?: string, enabled?: boolean }` → same `data` shape; 400 invalid username/password or enabling without credentials; 409 username taken (another customer, an employee, or the env admin username); 403 other roles.

- [ ] **Step 1: Write the failing integration script**

Create `tests/portal/qa-staff.ts`:

```ts
import { prisma, check, staffCookie, api, portalLogin, cleanupQa, QA_PASSWORD } from './qa-helpers'

const put = (id: string, body: object, role = 'ADMIN') =>
  api(`/api/retailers/${id}/portal`, staffCookie(role), { method: 'PUT', body: JSON.stringify(body) })

async function main() {
  try {
    const r = await prisma.retailer.create({ data: { name: 'QA Staff Portal Customer' } })
    const other = await prisma.retailer.create({ data: { name: 'QA Other Customer', portalUsername: 'qa-taken-name' } })

    // access control
    check('WAREHOUSE forbidden (403)', (await put(r.id, { username: 'qa-abc' }, 'WAREHOUSE')).status === 403)
    check('SALES_REP forbidden (403)', (await put(r.id, { username: 'qa-abc' }, 'SALES_REP')).status === 403)
    check('GET forbidden for TEAM_LEAD', (await api(`/api/retailers/${r.id}/portal`, staffCookie('TEAM_LEAD'))).status === 403)

    // validation
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
```

- [ ] **Step 2: Run it to verify it fails**

Run (dev server running): `npx tsx tests/portal/qa-staff.ts`
Expected: FAIL — the route does not exist (404s), cleanup still runs.

- [ ] **Step 3: Implement the staff API**

`app/api/retailers/[id]/portal/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { hashPortalPassword, validatePortalPassword, validatePortalUsername } from '@/lib/utils/portal-auth'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['ADMIN', 'MANAGER']

async function statusFor(id: string) {
  const r = await prisma.retailer.findUnique({
    where: { id },
    select: { portalUsername: true, portalEnabled: true, portalPasswordHash: true, portalLastLoginAt: true, portalLockedUntil: true },
  })
  if (!r) return null
  return {
    portalUsername: r.portalUsername,
    portalEnabled: r.portalEnabled,
    hasPassword: !!r.portalPasswordHash,
    portalLastLoginAt: r.portalLastLoginAt,
    lockedUntil: r.portalLockedUntil && r.portalLockedUntil > new Date() ? r.portalLockedUntil : null,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ALLOWED_ROLES.includes(getUserFromRequest(req).role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const data = await statusFor(id)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ALLOWED_ROLES.includes(getUserFromRequest(req).role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const existing = await prisma.retailer.findUnique({
    where: { id },
    select: { portalUsername: true, portalPasswordHash: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: Prisma.RetailerUpdateInput = {}

  if (body.username !== undefined) {
    const username = validatePortalUsername(body.username)
    if (!username) {
      return NextResponse.json({ error: 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore' }, { status: 400 })
    }
    const [dupCustomer, dupEmployee] = await Promise.all([
      prisma.retailer.findFirst({ where: { portalUsername: username, NOT: { id } }, select: { id: true } }),
      prisma.employee.findFirst({ where: { username: { equals: username, mode: 'insensitive' } }, select: { id: true } }),
    ])
    const adminName = (process.env.AUTH_USERNAME ?? 'admin').toLowerCase()
    if (dupCustomer || dupEmployee || username === adminName) {
      return NextResponse.json({ error: 'That username is already in use' }, { status: 409 })
    }
    data.portalUsername = username
  }

  if (body.password !== undefined) {
    if (!validatePortalPassword(body.password)) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    data.portalPasswordHash = hashPortalPassword(body.password)
    data.portalSessionVersion = { increment: 1 } // log the customer out everywhere
    data.portalFailedAttempts = 0
    data.portalLockedUntil = null
  }

  if (body.enabled !== undefined) {
    const enabled = !!body.enabled
    if (enabled) {
      const hasUsername = !!(data.portalUsername ?? existing.portalUsername)
      const hasPassword = !!(data.portalPasswordHash ?? existing.portalPasswordHash)
      if (!hasUsername || !hasPassword) {
        return NextResponse.json({ error: 'Set a username and password before enabling portal access' }, { status: 400 })
      }
    } else {
      data.portalSessionVersion = { increment: 1 }
    }
    data.portalEnabled = enabled
  }

  try {
    await prisma.retailer.update({ where: { id }, data })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'That username is already in use' }, { status: 409 })
    }
    throw e
  }
  return NextResponse.json({ data: await statusFor(id) })
}
```

- [ ] **Step 4: Build the Portal access card and mount it**

`components/retailers/PortalAccessCard.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils/format'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

interface PortalStatus {
  portalUsername: string | null
  portalEnabled: boolean
  hasPassword: boolean
  portalLastLoginAt: string | null
  lockedUntil: string | null
}

// Staff-only (ADMIN/MANAGER) — customers cannot change their own password; staff set and reset it here.
export function PortalAccessCard({ retailerId }: { retailerId: string }) {
  const { user } = useCurrentUser()
  const allowed = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [status, setStatus] = useState<PortalStatus | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/retailers/${retailerId}/portal`)
    if (!res.ok) return
    const j = await res.json()
    setStatus(j.data)
    setUsername(j.data.portalUsername ?? '')
  }, [retailerId])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  if (!allowed) return null

  const save = async (body: object, okMessage: string) => {
    setSaving(true)
    const res = await fetch(`/api/retailers/${retailerId}/portal`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await res.json()
    setSaving(false)
    if (!res.ok) { toast.error(j.error ?? 'Could not save'); return }
    toast.success(okMessage)
    setPassword('')
    setStatus(j.data)
    setUsername(j.data.portalUsername ?? '')
  }

  const saveLogin = () => {
    const body: { username?: string; password?: string } = {}
    if (username.trim() && username.trim().toLowerCase() !== (status?.portalUsername ?? '')) body.username = username
    if (password) body.password = password
    if (!body.username && !body.password) { toast.error('Enter a new username and/or password'); return }
    save(body, body.password ? 'Login saved — the customer was signed out of any open session' : 'Username saved')
  }

  const stateBadge = !status ? null
    : status.lockedUntil ? <Badge className="bg-red-100 text-red-700">Locked</Badge>
    : status.portalEnabled ? <Badge className="bg-green-100 text-green-700">Enabled</Badge>
    : status.portalUsername ? <Badge className="bg-slate-100 text-slate-600">Disabled</Badge>
    : <Badge variant="outline">Not set up</Badge>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound size={16} className="text-blue-500" /> Portal access {stateBadge}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Username</label>
          <Input className="h-8" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. alipharmacy" autoComplete="off" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">{status?.hasPassword ? 'Reset password' : 'Password'} (min 8 characters)</label>
          <Input className="h-8" type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder={status?.hasPassword ? 'Leave blank to keep the current one' : ''} autoComplete="off" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={saveLogin} disabled={saving}>Save login</Button>
          {status?.portalUsername && status.hasPassword && (
            <Button size="sm" variant="outline" disabled={saving}
              onClick={() => save({ enabled: !status.portalEnabled }, status.portalEnabled ? 'Portal access disabled' : 'Portal access enabled')}>
              {status.portalEnabled ? 'Disable access' : 'Enable access'}
            </Button>
          )}
        </div>
        {status?.portalLastLoginAt && <p className="text-xs text-slate-400">Last login: {formatDate(status.portalLastLoginAt)}</p>}
        {status?.lockedUntil && <p className="text-xs text-red-600">Locked after repeated wrong passwords — resetting the password unlocks it.</p>}
        <p className="text-xs text-slate-400">Customers sign in at <span className="font-mono">/portal/login</span>. They cannot change their own password.</p>
      </CardContent>
    </Card>
  )
}
```

In `app/(erp)/retailers/[id]/page.tsx`: add `import { PortalAccessCard } from '@/components/retailers/PortalAccessCard'` with the other imports, and insert `<PortalAccessCard retailerId={retailer.id} />` immediately **before** the `<Card>` whose header is `Credit & Compliance` (search for `<CardHeader><CardTitle className="text-base">Credit & Compliance</CardTitle></CardHeader>`; place the component just above that card's opening `<Card>` tag, as a sibling).

- [ ] **Step 5: Run to verify**

Run: `npx tsc --noEmit` (clean), then `npx tsx tests/portal/qa-staff.ts` (dev server running).
Expected: all `PASS`, `cleanup done`. Then smoke-check the page compiles: request `/retailers/<any id>` is covered in Task 8.

---

### Task 6: Portal order APIs (open order, save/replace, history)

**Files:**
- Create: `lib/portal/order.ts`, `app/api/portal/order/route.ts`, `app/api/portal/orders/route.ts`, `tests/portal/qa-orders.ts`

**Interfaces:**
- Consumes: `PortalCustomer` (Task 2), `resolveOfferListId`/`loadOfferItems` (Task 4), `sanitizeCart`/`buildPricedLines`/`PricedLine` (Task 3), `generateOrderNumber` (`lib/utils/format.ts`).
- Produces:
  - `interface PortalOrderView { id: string; orderNumber: string; orderDate: string; status: string; totalAmount: number; invoiceTotal: number | null; scheduledDate: string | null; items: { medicineId: string; code: string; name: string; quantity: number; unitPrice: number; offerPercent: number; lineTotal: number }[] }`
  - `GET /api/portal/order` → `{ data: PortalOrderView | null }` (the open PENDING `OFFER_LIST` order)
  - `PUT /api/portal/order` body `{ orderId: string | null, items: { medicineId, quantity }[] }` → `{ data: PortalOrderView | null }` (null = open order deleted because the cart was emptied) | 400 invalid cart / no offer list / empty cart with no order | 409 `{ error: string }` conflicts (see below)
  - `GET /api/portal/orders` → `{ data: PortalOrderView[] }` (newest first, max 50)
- Conflict rules (all `409`): `orderId` set but not the current open PENDING portal order (confirmed/cancelled/deleted/not theirs) → "Your order was confirmed by our team — your changes were not saved"; `orderId: null` while an open order exists (second tab/device) → "You already have an open order — it has been reloaded".

- [ ] **Step 1: Write the failing integration script**

Create `tests/portal/qa-orders.ts`:

```ts
import { prisma, check, makeQaCustomer, portalLogin, api, ensureQaOffer, staffCookie, cleanupQa } from './qa-helpers'

const putOrder = (cookie: string, body: object) => api('/api/portal/order', cookie, { method: 'PUT', body: JSON.stringify(body) })

async function main() {
  try {
    const offer = await ensureQaOffer()
    const { retailer, username, password } = await makeQaCustomer({ customerType: 'QA-Type-Orders' })
    await prisma.offerListCustomer.create({ data: { offerListId: offer.listId, retailerId: retailer.id } })
    const cookie = (await portalLogin(username, password)).cookie!
    const M = offer.medicineId

    // nothing open yet
    check('no open order initially', (await (await api('/api/portal/order', cookie)).json()).data === null)

    // tampered / invalid carts
    check('foreign medicineId -> 400', (await putOrder(cookie, { orderId: null, items: [{ medicineId: 'not-on-my-list', quantity: 1 }] })).status === 400)
    for (const q of [-1, 1.5, 10000, '5']) {
      check(`quantity ${JSON.stringify(q)} -> 400`, (await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: q }] })).status === 400)
    }
    check('duplicate ids -> 400', (await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 1 }, { medicineId: M, quantity: 2 }] })).status === 400)
    check('empty cart with no order -> 400', (await putOrder(cookie, { orderId: null, items: [] })).status === 400)
    check('no order was created by the bad requests', (await prisma.order.count({ where: { retailerId: retailer.id } })) === 0)

    // place: client-supplied price is ignored; priced server-side (T.P. 100, 10% off)
    let r = await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 5, unitPrice: 0.01, offerPercent: 99 }] })
    let j = await r.json()
    check('place order 200', r.status === 200)
    check('priced server-side: 5 x 100 x 0.9 = 450', j.data?.totalAmount === 450 && j.data.items[0].unitPrice === 100 && j.data.items[0].offerPercent === 10, JSON.stringify(j.data))
    const db = await prisma.order.findFirst({ where: { retailerId: retailer.id }, include: { items: true } })
    check('stored PENDING / OFFER_LIST / MRP snapshot', db?.status === 'PENDING' && db.source === 'OFFER_LIST' && Number(db.items[0].mrp) === 130 && Number(db.totalAmount) === 450)
    const orderId = j.data.id as string

    // GET returns it; the offer-list page can pre-fill from this
    j = await (await api('/api/portal/order', cookie)).json()
    check('open order returned', j.data?.id === orderId && j.data.items[0].quantity === 5)

    // update replaces lines in the SAME order (no second order, no double-adding)
    r = await putOrder(cookie, { orderId, items: [{ medicineId: M, quantity: 8 }] })
    j = await r.json()
    check('update keeps same order, qty replaced (8 x 90 = 720)', r.status === 200 && j.data.id === orderId && j.data.items.length === 1 && j.data.totalAmount === 720)
    check('still exactly one order', (await prisma.order.count({ where: { retailerId: retailer.id } })) === 1)

    // second tab / device that thinks there is no open order
    r = await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 1 }] })
    check('orderId null while an order is open -> 409', r.status === 409)
    check('…and nothing changed', Number((await prisma.order.findUnique({ where: { id: orderId } }))?.totalAmount) === 720)

    // a staff-created PENDING order for this customer is never touched
    const staffOrder = await prisma.order.create({ data: { orderNumber: `QA-STAFF-${Date.now()}`, retailerId: retailer.id, status: 'PENDING', source: 'MANUAL', totalAmount: 1 } })
    await putOrder(cookie, { orderId, items: [{ medicineId: M, quantity: 2 }] })
    check('staff MANUAL pending order untouched', (await prisma.order.findUnique({ where: { id: staffOrder.id } }))?.totalAmount.toString() === '1')

    // history shows both statuses
    j = await (await api('/api/portal/orders', cookie)).json()
    check('history lists portal orders newest-first, includes staff order', Array.isArray(j.data) && j.data.length === 2)

    // staff confirms mid-edit -> 409, edit not applied; next order starts fresh
    const conf = await api(`/api/orders/${orderId}/status`, staffCookie(), { method: 'PUT', body: JSON.stringify({ status: 'CONFIRMED' }) })
    check('staff confirm ok', conf.status === 200)
    r = await putOrder(cookie, { orderId, items: [{ medicineId: M, quantity: 99 }] })
    check('edit after confirm -> 409', r.status === 409 && /confirmed/i.test((await r.json()).error))
    check('confirmed order unchanged (2 x 90 = 180)', Number((await prisma.order.findUnique({ where: { id: orderId } }))?.totalAmount) === 180)
    check('no open order after confirm', (await (await api('/api/portal/order', cookie)).json()).data === null)
    r = await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 3 }] })
    j = await r.json()
    check('next order is a NEW order', r.status === 200 && j.data.id !== orderId && j.data.totalAmount === 270)
    const newId = j.data.id as string
    j = await (await api('/api/portal/orders', cookie)).json()
    const confirmed = j.data.find((o: { id: string }) => o.id === orderId)
    check('history shows confirmed status, invoice total and delivery date', confirmed?.status === 'CONFIRMED' && confirmed.invoiceTotal === 180 && !!confirmed.scheduledDate, JSON.stringify(confirmed))

    // zero-out a line, then clear the cart deletes the open order
    r = await putOrder(cookie, { orderId: newId, items: [{ medicineId: M, quantity: 0 }] })
    check('clearing the cart -> 200 with data null', r.status === 200 && (await r.json()).data === null)
    check('open order deleted', (await prisma.order.findUnique({ where: { id: newId } })) === null)

    // another customer cannot touch this customer's order
    const other = await makeQaCustomer({ customerType: 'QA-Type-Orders' })
    await prisma.offerListCustomer.create({ data: { offerListId: offer.listId, retailerId: other.retailer.id } })
    const oc = (await portalLogin(other.username, other.password)).cookie!
    const mine = (await (await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 1 }] })).json()).data.id as string
    check("other customer's PUT with my orderId -> 409, my order intact", (await putOrder(oc, { orderId: mine, items: [{ medicineId: M, quantity: 7 }] })).status === 409 && Number((await prisma.order.findUnique({ where: { id: mine } }))?.totalAmount) === 90)

    // unauthenticated + no entitlement
    check('PUT without cookie -> 401', (await fetch('http://localhost:3100/api/portal/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 401)
    const nobody = await makeQaCustomer({ customerType: 'QA-Unentitled' })
    const nc = (await portalLogin(nobody.username, nobody.password)).cookie!
    check('customer without an offer list cannot order (400)', (await putOrder(nc, { orderId: null, items: [{ medicineId: M, quantity: 1 }] })).status === 400)
  } finally {
    await cleanupQa()
    console.log('cleanup done')
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run it to verify it fails**

Run (dev server running): `npx tsx tests/portal/qa-orders.ts`
Expected: FAIL — `/api/portal/order` does not exist; cleanup still runs.

- [ ] **Step 3: Implement `lib/portal/order.ts`**

```ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateOrderNumber } from '@/lib/utils/format'
import type { PricedLine } from '@/lib/portal/pricing'

export interface PortalOrderView {
  id: string
  orderNumber: string
  orderDate: string
  status: string
  totalAmount: number          // product subtotal, excludes sales tax
  invoiceTotal: number | null  // tax-inclusive, once staff have confirmed and an invoice exists
  scheduledDate: string | null
  items: { medicineId: string; code: string; name: string; quantity: number; unitPrice: number; offerPercent: number; lineTotal: number }[]
}

export const orderViewInclude = {
  items: { include: { medicine: { select: { code: true, name: true } } }, orderBy: { id: 'asc' as const } },
  invoice: { select: { totalAmount: true } },
  delivery: { select: { scheduledDate: true } },
} satisfies Prisma.OrderInclude

type OrderWithView = Prisma.OrderGetPayload<{ include: typeof orderViewInclude }>

/** Explicit whitelist — the browser never receives the raw Order row. */
export function serializeOrder(o: OrderWithView): PortalOrderView {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    orderDate: o.orderDate.toISOString(),
    status: o.status,
    totalAmount: Number(o.totalAmount),
    invoiceTotal: o.invoice ? Number(o.invoice.totalAmount) : null,
    scheduledDate: o.delivery ? o.delivery.scheduledDate.toISOString() : null,
    items: o.items.map(i => ({
      medicineId: i.medicineId,
      code: i.medicine.code,
      name: i.medicine.name,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      offerPercent: Number(i.offerPercent),
      lineTotal: Number(i.lineTotal),
    })),
  }
}

export async function findOpenOrder(retailerId: string): Promise<PortalOrderView | null> {
  const o = await prisma.order.findFirst({
    where: { retailerId, status: 'PENDING', source: 'OFFER_LIST' },
    orderBy: { createdAt: 'desc' },
    include: orderViewInclude,
  })
  return o ? serializeOrder(o) : null
}

export class PortalConflict extends Error {}

export const CONFIRMED_MESSAGE = 'Your order was confirmed by our team — your changes were not saved'
export const ALREADY_OPEN_MESSAGE = 'You already have an open order — it has been reloaded'

/**
 * Create / replace / delete the customer's open order in one transaction.
 *  - orderId set  → must be the customer's current open PENDING portal order, else PortalConflict.
 *  - orderId null → must have no open order (a second tab/device would otherwise overwrite), else PortalConflict.
 *  - empty `lines` with an orderId → the (portal-created, PENDING) order is deleted; returns null.
 * The caller has already validated the cart and priced every line server-side.
 */
export async function savePortalOrder(params: {
  retailerId: string
  salesRepId: string | null
  orderId: string | null
  lines: PricedLine[]
  total: number
}): Promise<PortalOrderView | null> {
  const { retailerId, salesRepId, orderId, lines, total } = params
  const lineData = lines.map(l => ({
    medicineId: l.medicineId, quantity: l.quantity, mrp: l.mrp, unitPrice: l.unitPrice, offerPercent: l.offerPercent,
    salesTax: l.salesTax, salesTaxAmount: l.salesTaxAmount, lineTotal: l.lineTotal,
  }))

  // orderNumber is "SP-YYYYMMDD-<random 4 digits>"; retry on the (unlikely) unique collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const open = await tx.order.findFirst({
          where: { retailerId, status: 'PENDING', source: 'OFFER_LIST' },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })

        if (orderId) {
          if (!open || open.id !== orderId) throw new PortalConflict(CONFIRMED_MESSAGE)
        } else if (open) {
          throw new PortalConflict(ALREADY_OPEN_MESSAGE)
        }

        if (lines.length === 0) {
          // orderId is guaranteed set here (the route rejects an empty cart without one)
          await tx.order.delete({ where: { id: orderId! } }) // items cascade
          return null
        }

        let id: string
        if (orderId) {
          await tx.orderItem.deleteMany({ where: { orderId } })
          await tx.order.update({ where: { id: orderId }, data: { totalAmount: total, items: { create: lineData } } })
          id = orderId
        } else {
          const created = await tx.order.create({
            data: {
              orderNumber: generateOrderNumber(),
              retailerId,
              salesRepId,
              source: 'OFFER_LIST',
              totalAmount: total,
              items: { create: lineData },
            },
            select: { id: true },
          })
          id = created.id
        }
        const saved = await tx.order.findUniqueOrThrow({ where: { id }, include: orderViewInclude })
        return serializeOrder(saved)
      })
    } catch (e) {
      const isNumberCollision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && !orderId
      if (isNumberCollision && attempt < 2) continue
      throw e
    }
  }
  throw new Error('unreachable')
}
```

- [ ] **Step 4: Implement the three routes**

`app/api/portal/order/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getPortalCustomerFromRequest } from '@/lib/portal/session'
import { resolveOfferListId, loadOfferItems } from '@/lib/portal/offer-list'
import { buildPricedLines, sanitizeCart } from '@/lib/portal/pricing'
import { findOpenOrder, savePortalOrder, PortalConflict } from '@/lib/portal/order'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ data: await findOpenOrder(customer.id) })
}

export async function PUT(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const orderId: string | null = typeof body?.orderId === 'string' && body.orderId ? body.orderId : null

  const cart = sanitizeCart(body?.items)
  if (!cart.ok) return NextResponse.json({ error: cart.error }, { status: 400 })
  if (cart.lines.length === 0 && !orderId) {
    return NextResponse.json({ error: 'Add at least one item to place an order' }, { status: 400 })
  }

  // Prices always come from the customer's own offer list, never from the request
  const listId = await resolveOfferListId(customer)
  if (!listId) return NextResponse.json({ error: 'No offer list is available for you right now' }, { status: 400 })
  const offers = new Map((await loadOfferItems(listId)).map(o => [o.medicineId, o]))
  const priced = buildPricedLines(cart.lines, offers)
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 })

  try {
    const data = await savePortalOrder({
      retailerId: customer.id,
      salesRepId: customer.salesRepId,
      orderId,
      lines: priced.lines,
      total: priced.total,
    })
    return NextResponse.json({ data })
  } catch (e) {
    if (e instanceof PortalConflict) return NextResponse.json({ error: e.message }, { status: 409 })
    throw e
  }
}
```

`app/api/portal/orders/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPortalCustomerFromRequest } from '@/lib/portal/session'
import { orderViewInclude, serializeOrder } from '@/lib/portal/order'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const customer = await getPortalCustomerFromRequest(req)
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orders = await prisma.order.findMany({
    where: { retailerId: customer.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: orderViewInclude,
  })
  return NextResponse.json({ data: orders.map(serializeOrder) })
}
```

- [ ] **Step 5: Run to verify**

Run: `npx tsc --noEmit` (clean), then `npx tsx tests/portal/qa-orders.ts` (dev server running).
Expected: all `PASS`, `cleanup done`. The `staff confirm ok` step creates an Invoice + Delivery + DeliveryChallan for the QA order (they are removed by `cleanupQa`). If any `FAIL`, fix the route/lib — do not weaken the test.

---

### Task 7: Portal UI (login, shell, Order tab, My Orders tab)

**Files:**
- Create: `app/portal/login/page.tsx`, `components/portal/PortalShell.tsx`, `app/portal/(app)/layout.tsx`, `app/portal/(app)/page.tsx`, `app/portal/(app)/orders/page.tsx`

**Interfaces:**
- Consumes: `getPortalCustomer` (Task 2), `PORTAL_COOKIE`, APIs `/api/portal/{login,logout,me,offer-list,order,orders}` with the shapes defined in Tasks 2, 4, 6, `WEEKDAYS` (`lib/utils/area-schedule.ts`), `formatPKR`/`formatDate` (`lib/utils/format.ts`).
- Produces: pages `/portal/login`, `/portal` (Order tab), `/portal/orders` (My Orders). No exports used elsewhere.

- [ ] **Step 1: Login page**

`app/portal/login/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff, Lock } from 'lucide-react'

export default function PortalLoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await fetch('/api/portal/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
    })
    if (res.ok) {
      router.push('/portal')
      router.refresh()
      return
    }
    const j = await res.json().catch(() => ({}))
    setError(j.error ?? 'Login failed')
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Image src="/logo.png" alt="Shelf Pharma" width={180} height={72} className="object-contain" priority />
        </div>
        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-slate-900">Customer Portal</h1>
            <p className="text-sm text-slate-500 mt-1">Sign in to place your order</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" autoComplete="username" autoCapitalize="none" value={username}
                onChange={e => setUsername(e.target.value)} disabled={loading} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
                  onChange={e => setPassword(e.target.value)} disabled={loading} className="pr-10" />
                <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}
            <Button type="submit" className="w-full gap-2" disabled={loading || !username || !password}>
              <Lock size={14} /> {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="text-xs text-center text-slate-400">Forgot your password? Contact Shelf Pharma — 0330-7774353</p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Shell + guarded layout**

`components/portal/PortalShell.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'

export function PortalShell({ customerName, children }: { customerName: string; children: React.ReactNode }) {
  const pathname = usePathname()

  const logout = async () => {
    await fetch('/api/portal/logout', { method: 'POST' })
    window.location.href = '/portal/login'
  }

  const tab = (href: string, label: string) => {
    const active = href === '/portal' ? pathname === '/portal' : pathname.startsWith(href)
    return (
      <Link href={href}
        className={`px-4 py-2 text-sm font-medium border-b-2 ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
        {label}
      </Link>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 pt-3 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs text-slate-400">Shelf Pharma</p>
            <p className="font-semibold text-slate-900 truncate">{customerName}</p>
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <LogOut size={15} /> Sign out
          </button>
        </div>
        <nav className="max-w-3xl mx-auto px-2 flex">
          {tab('/portal', 'Order')}
          {tab('/portal/orders', 'My Orders')}
        </nav>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-4">{children}</main>
    </div>
  )
}
```

`app/portal/(app)/layout.tsx`:

```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PORTAL_COOKIE } from '@/lib/utils/portal-auth'
import { getPortalCustomer } from '@/lib/portal/session'
import { PortalShell } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value
  const customer = await getPortalCustomer(token)
  if (!customer) redirect('/portal/login')
  return <PortalShell customerName={customer.name}>{children}</PortalShell>
}
```

- [ ] **Step 3: Order tab**

`app/portal/(app)/page.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Search, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { WEEKDAYS } from '@/lib/utils/area-schedule'
import { formatPKR } from '@/lib/utils/format'

interface Me { name: string; deliveryDays: number[]; nextBooking: { day: number; cutoffHour: number; isToday: boolean } | null }
interface Item { medicineId: string; code: string; name: string; manufacturer: string; unitPrice: number; offerPercent: number; comment: string }
interface OpenOrder { id: string; orderNumber: string; items: { medicineId: string; quantity: number }[] }

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`
const unitNet = (i: Item) => i.unitPrice * (1 - i.offerPercent / 100)

export default function PortalOrderPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<Item[] | null>(null) // null = loading, [] with noList handled below
  const [noList, setNoList] = useState(false)
  const [open, setOpen] = useState<OpenOrder | null>(null)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [m, o, ord] = await Promise.all([
      fetch('/api/portal/me').then(r => r.json()),
      fetch('/api/portal/offer-list').then(r => r.json()),
      fetch('/api/portal/order').then(r => r.json()),
    ])
    setMe(m.data ?? null)
    setNoList(!o.data)
    setItems(o.data?.items ?? [])
    const order: OpenOrder | null = ord.data ?? null
    setOpen(order)
    const savedMap: Record<string, number> = {}
    for (const l of order?.items ?? []) savedMap[l.medicineId] = l.quantity
    setSaved(savedMap)
    setQty(Object.fromEntries(Object.entries(savedMap).map(([k, v]) => [k, String(v)])))
  }, [])

  useEffect(() => { load() }, [load])

  const onList = useMemo(() => new Set((items ?? []).map(i => i.medicineId)), [items])
  const quantityOf = (id: string) => {
    const n = parseInt(qty[id] ?? '', 10)
    return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 0
  }

  const cart = useMemo(
    () => (items ?? []).filter(i => quantityOf(i.medicineId) > 0).map(i => ({ item: i, quantity: quantityOf(i.medicineId) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, qty]
  )
  const total = cart.reduce((s, c) => s + c.quantity * unitNet(c.item), 0)

  // Lines on the saved order whose item is no longer on the offer list are dropped on the next save
  const droppedCount = Object.keys(saved).filter(id => !onList.has(id)).length
  const dirty = (() => {
    const now: Record<string, number> = {}
    for (const c of cart) now[c.item.medicineId] = c.quantity
    const keys = new Set([...Object.keys(now), ...Object.keys(saved)])
    return Array.from(keys).some(k => (now[k] ?? 0) !== (saved[k] ?? 0))
  })()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (items ?? []).filter(i => !q || `${i.name} ${i.code} ${i.manufacturer}`.toLowerCase().includes(q))
  }, [items, search])

  const place = async () => {
    setSaving(true)
    const res = await fetch('/api/portal/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: open?.id ?? null, items: cart.map(c => ({ medicineId: c.item.medicineId, quantity: c.quantity })) }),
    })
    const j = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.status === 409) {
      toast.error(j.error ?? 'Your order changed — it has been reloaded')
      await load()
      return
    }
    if (!res.ok) { toast.error(j.error ?? 'Could not save your order'); return }
    toast.success(j.data ? (open ? 'Order updated' : 'Order placed — our team will review it shortly') : 'Order removed')
    await load()
  }

  if (items === null) return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-white rounded-lg animate-pulse" />)}</div>

  let manufacturerShown = ''

  return (
    <div className="space-y-4 pb-28">
      {/* Delivery days + booking cut-off */}
      {me && (me.deliveryDays.length > 0 || me.nextBooking) && (
        <div className="bg-white rounded-xl border p-4 space-y-2">
          {me.deliveryDays.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5"><CalendarDays size={14} /> Delivery days</p>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {me.deliveryDays.map(d => (
                  <span key={d} className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">{WEEKDAYS[d]}</span>
                ))}
              </div>
            </div>
          )}
          {me.nextBooking && (
            <p className="text-sm text-slate-600">
              Order by <strong>{me.nextBooking.isToday ? 'today' : WEEKDAYS[me.nextBooking.day]} {hourLabel(me.nextBooking.cutoffHour)}</strong> for the next booking.
            </p>
          )}
        </div>
      )}

      {open && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
          You have an open order <strong>{open.orderNumber}</strong>. Change the quantities below and tap <strong>Update Order</strong> —
          set a quantity to 0 to remove an item. It can be changed until our team confirms it.
          {droppedCount > 0 && <span className="block mt-1">{droppedCount} item(s) on it are no longer on the offer list and will be removed when you update.</span>}
        </div>
      )}

      {noList ? (
        <div className="bg-white rounded-xl border p-8 text-center text-slate-500">No offer list is available for you right now.</div>
      ) : (
        <>
          <div className="relative sticky top-[92px] z-10">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Search medicine, code or company…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white" />
          </div>

          {filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-10">No items match your search.</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map(i => {
                const header = i.manufacturer !== manufacturerShown ? i.manufacturer : null
                manufacturerShown = i.manufacturer
                const q = quantityOf(i.medicineId)
                return (
                  <div key={i.medicineId}>
                    {header !== null && <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-3 pb-1">{header || 'Other'}</p>}
                    <div className={`bg-white rounded-lg border px-3 py-2.5 flex items-center gap-3 ${q > 0 ? 'border-blue-300 bg-blue-50/40' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-snug">{i.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          T.P. {formatPKR(i.unitPrice)}
                          {i.offerPercent > 0 && <span className="text-green-700 font-medium"> · {i.offerPercent.toFixed(1)}% off</span>}
                          {i.comment && i.comment !== '—' && <span className="text-slate-400"> · {i.comment}</span>}
                        </p>
                      </div>
                      <Input
                        type="number" inputMode="numeric" min={0} max={9999} placeholder="Qty"
                        aria-label={`Quantity for ${i.name}`}
                        className="w-20 h-9 text-center"
                        value={qty[i.medicineId] ?? ''}
                        onChange={e => setQty(p => ({ ...p, [i.medicineId]: e.target.value }))}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Floating action button */}
      {!noList && (cart.length > 0 || (open && dirty)) && (
        <div className="fixed bottom-4 inset-x-4 z-30 max-w-3xl mx-auto">
          <button
            onClick={place}
            disabled={saving || !dirty}
            className="w-full rounded-xl bg-blue-600 text-white font-semibold py-3.5 shadow-lg disabled:opacity-60 active:scale-[0.99]"
          >
            {saving ? 'Saving…' : cart.length === 0
              ? 'Remove all items'
              : `${open ? 'Update Order' : 'Place Order'} · ${cart.length} item${cart.length !== 1 ? 's' : ''} · ${formatPKR(total)}`}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: My Orders tab**

`app/portal/(app)/orders/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { formatPKR, formatDate } from '@/lib/utils/format'

interface OrderView {
  id: string; orderNumber: string; orderDate: string; status: string
  totalAmount: number; invoiceTotal: number | null; scheduledDate: string | null
  items: { medicineId: string; name: string; quantity: number; lineTotal: number }[]
}

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:    { label: 'Awaiting confirmation', cls: 'bg-amber-100 text-amber-800' },
  CONFIRMED:  { label: 'Confirmed',             cls: 'bg-blue-100 text-blue-800' },
  PICKING:    { label: 'Being prepared',        cls: 'bg-blue-100 text-blue-800' },
  DISPATCHED: { label: 'Out for delivery',      cls: 'bg-indigo-100 text-indigo-800' },
  DELIVERED:  { label: 'Delivered',             cls: 'bg-green-100 text-green-800' },
  CANCELLED:  { label: 'Cancelled',             cls: 'bg-red-100 text-red-700' },
}

export default function PortalOrdersPage() {
  const [orders, setOrders] = useState<OrderView[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal/orders').then(r => r.json()).then(j => setOrders(j.data ?? []))
  }, [])

  if (orders === null) return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-white rounded-lg animate-pulse" />)}</div>
  if (orders.length === 0) return <div className="bg-white rounded-xl border p-8 text-center text-slate-500">You have not placed any orders yet.</div>

  return (
    <div className="space-y-3">
      {orders.map(o => {
        const st = STATUS[o.status] ?? { label: o.status, cls: 'bg-slate-100 text-slate-700' }
        const expanded = openId === o.id
        return (
          <div key={o.id} className="bg-white rounded-xl border">
            <button className="w-full text-left p-4" onClick={() => setOpenId(expanded ? null : o.id)}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-xs text-slate-500">{o.orderNumber}</p>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
              </div>
              <div className="flex items-end justify-between mt-1.5">
                <div className="text-sm text-slate-600">
                  <p>{formatDate(o.orderDate)} · {o.items.length} item{o.items.length !== 1 ? 's' : ''}</p>
                  {o.scheduledDate && o.status !== 'CANCELLED' && <p className="text-xs text-slate-500">Delivery: {formatDate(o.scheduledDate)}</p>}
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatPKR(o.invoiceTotal ?? o.totalAmount)}</p>
                  <p className="text-[11px] text-slate-400">{o.invoiceTotal !== null ? 'Invoice total' : 'Excl. tax'}</p>
                </div>
              </div>
            </button>
            {expanded && (
              <div className="border-t px-4 py-2 divide-y">
                {o.items.map(i => (
                  <div key={i.medicineId} className="flex justify-between py-1.5 text-sm">
                    <span>{i.name} <span className="text-slate-400">× {i.quantity}</span></span>
                    <span className="text-slate-600">{formatPKR(i.lineTotal)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Type-check and smoke-test the pages**

Run: `npx tsc --noEmit` → clean. With the dev server running, verify (using a QA customer + cookie from the helpers) that:
`/portal/login` → 200 (no cookie); `/portal` and `/portal/orders` without a cookie → redirect (307) to `/portal/login`; with a valid `sp_customer` cookie → 200 and the HTML contains the customer's name. Use a throwaway script `tests/portal/qa-pages.ts`:

```ts
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
```

Run: `npx tsx tests/portal/qa-pages.ts`
Expected: all `PASS`. If a staff page returns 200 for the customer cookie, STOP — the `(erp)` layout must only accept `sp_session` (it does today; investigate rather than patching the test).

---

### Task 8: Full verification, build, and docs

**Files:**
- Modify: `../CLAUDE.md` (project docs one level above the app root: `C:\Users\OK COMPUTER\Desktop\AI Projects\Pharma\CLAUDE.md`)

**Interfaces:** none (verification and documentation).

- [ ] **Step 1: Re-run every automated check from a clean state**

With the dev server running:

```bash
npx tsc --noEmit
npx tsx --test tests/portal/portal-auth.test.ts tests/portal/schedule.test.ts tests/portal/pricing.test.ts
npx tsx tests/portal/qa-auth.ts
npx tsx tests/portal/qa-staff.ts
npx tsx tests/portal/qa-offer.ts
npx tsx tests/portal/qa-orders.ts
npx tsx tests/portal/qa-pages.ts
```
Expected: unit tests all pass (20 tests); every integration script prints only `PASS` lines then `cleanup done`; exit code 0 for each.

- [ ] **Step 2: Confirm no QA residue in the production DB**

```bash
cat > qa-residue.tmp.ts <<'EOF'
import 'dotenv/config'
import { prisma } from './lib/prisma'
async function main() {
  console.log({
    retailers: await prisma.retailer.count({ where: { name: { startsWith: 'QA ' } } }),
    portalUsernames: await prisma.retailer.count({ where: { portalUsername: { startsWith: 'qa-' } } }),
    medicines: await prisma.medicine.count({ where: { code: { startsWith: 'QA' } } }),
    offerLists: await prisma.offerList.count({ where: { listNumber: { startsWith: 'QA' } } }),
    orders: await prisma.order.count({ where: { orderNumber: { startsWith: 'QA' } } }),
    areas: await prisma.area.count({ where: { name: { startsWith: 'QA ' } } }),
    activeLists: await prisma.offerList.count({ where: { isActive: true } }),
  })
  await prisma.$disconnect()
}
main()
EOF
npx tsx qa-residue.tmp.ts; rm -f qa-residue.tmp.ts
```
Expected: all `QA` counts `0`; `activeLists` equals what it was before testing (0 or 1 — a QA run never leaves an extra active list).

- [ ] **Step 3: Stop the dev server and run the production build**

Stop the process listening on port 3100 (PowerShell: `Get-NetTCPConnection -LocalPort 3100 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`), then `npm run build`.
Expected: "Compiled successfully", and the route table lists `/portal`, `/portal/login`, `/portal/orders`, `/api/portal/*`, `/api/retailers/[id]/portal`.

- [ ] **Step 4: Document the phase in `CLAUDE.md`**

Add a section immediately above `### Not Yet Done`:

```markdown
### Phase 13 — Customer Portal (2026-10-11)
- Customers (model `Retailer`) log in at `/portal/login` with a username/password **set by staff** (ADMIN/MANAGER, "Portal access" card on the customer page, `GET/PUT /api/retailers/[id]/portal`); they cannot change their own password. Spec: `shelfpharma-erp/docs/superpowers/specs/2026-10-11-customer-portal-design.md`; plan: `.../plans/2026-10-11-customer-portal.md`.
- **Separate session, deliberately**: cookie `sp_customer` (HMAC, 7 days, `lib/utils/portal-auth.ts`), never `sp_session`. Because `middleware.ts` only checks that `sp_session` exists and most ERP APIs do no role check, a customer holding a staff-style session could call any ERP API. With the separate cookie every non-portal `/api/*` returns 401 to customers. `/api/portal/*` is exempt in `middleware.ts` and authenticates itself via `getPortalCustomerFromRequest` (`lib/portal/session.ts`), which re-checks `isActive`/`portalEnabled`/`portalSessionVersion` on every request. The customer id comes only from the session.
- Customer passwords are scrypt + per-user salt (not the staff SHA-256 scheme); 5 failures lock the account 15 min; `portalSessionVersion` is bumped on password reset/disable to log the customer out everywhere. `Retailer.portalPasswordHash` is **globally omitted** by `lib/prisma.ts` (`omit`) — select it explicitly if you ever need it.
- Portal data: delivery days + next booking cut-off from the customer's `Area` (`nextBookingCutoff`, Asia/Karachi); the active Offer List if the customer has an individual sheet or their Customer Type is assigned (`lib/portal/offer-list.ts`). API responses are whitelisted (no Purchase %, cost, stock).
- Ordering: the customer's open order = their PENDING `OFFER_LIST` order; `PUT /api/portal/order` replaces its lines (qty 0 removes; clearing the cart deletes it), prices are computed server-side. `409` if staff already confirmed it or a second tab already has an open order. After confirmation the next order is a new PENDING order. Staff confirm through the unchanged `PUT /api/orders/[id]/status`.
- Tests: `tests/portal/*.test.ts` (unit, `npx tsx --test`) and `tests/portal/qa-*.ts` (integration against a dev server on :3100, **production DB**, QA-prefixed records cleaned up in `finally`).
```

Also in the "Role-Based Access" paragraph add one sentence: "Customers are not an `Employee.role` — they use the separate portal session described in Phase 13." And remove "Customer portal," from the "Planned next" bullet under `### Not Yet Done`.

- [ ] **Step 5: Final report**

Report to the user: what was built, the verification results (unit tests, five integration scripts, residue check, build), and the caveats — nothing is committed/pushed (a push redeploys production); the portal is inert until staff enable a customer; the pages were smoke-tested over HTTP but not clicked through in a browser; first real use should be a test customer created by staff.

---

## Self-Review

**Spec coverage**
- Separate `sp_customer` session, no `sp_session` for customers, `/api/portal/*` exempt, per-request account re-check → Tasks 1, 2 (tests: customer cookie 401 on staff APIs, staff cookie 401 on portal, version bump/disable/inactive).
- Schema fields (all 7) + hash omission → Task 1.
- Staff credential management (ADMIN/MANAGER, username rules incl. employee/env-admin clash, password min 8, reset bumps version + clears lockout, enable requires creds, no customer self-service) → Task 5.
- Login: generic errors, timing dummy hash, lockout 5/15, 429 → Task 2.
- Header card delivery days + next booking cut-off, hidden when unset → Tasks 4, 7.
- Offer list resolution (sheet or type assignment), whitelist payload, manufacturer grouping, search, floating button, T.P./Offer %/Comment → Tasks 4, 7.
- Ordering rules (open order = PENDING OFFER_LIST; replace semantics; 0 removes; clear deletes; 409 on confirmed; foreign medicine 400; server-side pricing incl. MRP snapshot, tax only if applicable; salesRep = customer's booker; staff PENDING untouched) → Tasks 3, 6.
- My Orders (status, totals, lines, delivery date once confirmed) → Tasks 6, 7.
- Out of scope items are absent. Testing list items 1–6 map to Tasks 2, 5, 4, 6, 5, 7/8.

**Spec gap resolved in the plan (flag in review):** the spec did not say what happens when `orderId: null` is sent while an open order already exists (two tabs/devices). The plan returns `409 "You already have an open order — it has been reloaded"` rather than silently overwriting or merging; Task 6's test pins it.

**Type/name consistency:** `ServerOfferItem`/`PortalOfferItem`/`toPublicItem`/`priceLine`/`sanitizeCart`/`buildPricedLines`/`PricedLine` (Task 3) are used verbatim in Tasks 4 and 6; `PortalCustomer`/`getPortalCustomerFromRequest` (Task 2) in Tasks 4, 6, 7; `resolveOfferListId`/`loadOfferItems` (Task 4) in Task 6; `PortalOrderView`/`orderViewInclude`/`serializeOrder`/`savePortalOrder`/`PortalConflict` (Task 6) in the routes; test helpers `makeQaCustomer`/`portalLogin`/`api`/`staffCookie`/`ensureQaOffer`/`cleanupQa`/`check` are defined in `qa-helpers.ts` (Tasks 2 and 4) before use. Compound-unique names `offerListId_retailerId` and `offerListId_customerType` match `prisma/schema.prisma`.
