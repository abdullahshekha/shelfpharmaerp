/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared helpers for the live-QA scripts that drive an order through the Phase 18 flow:
//   RECEIVED -> INVOICED (PUT /api/orders/[id]/status, ADMIN/MANAGER)
//            -> OUT_FOR_DELIVERY (POST /api/deliveries/[id]/assign { driverId }, ADMIN/MANAGER; stock leaves FEFO,
//               DELIVERY_COGS dated Delivery.assignedAt)
//            -> DELIVERED / ON_HOLD / RETURNED (POST /api/deliveries/[id]/outcome)
// Imported by tests/accounting/qa-{restock,sync,reports}.ts, tests/audit and tests/portal scripts. No side effects
// beyond loading .env.local (the dev server's AUTH_SECRET / NEXT_PUBLIC_SUPABASE_URL live there, see qa-deliveries.ts).
import { config as loadEnv } from 'dotenv'
import { prisma, BASE } from '../portal/qa-helpers'

loadEnv({ path: '.env.local' })

export type Res = { status: number; json: any }

export async function call(method: string, path: string, cookie: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json: any = await res.json().catch(() => null)
  return { status: res.status, json }
}

export const karachiDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
export const karachiToday = () => karachiDay(new Date())
export const karachiTomorrow = () => karachiDay(new Date(Date.now() + 86400000))

/**
 * Reads GET /api/deliveries/qa-mode (non-production diagnostic, 404 in production): whether the dev server skips the
 * post-commit ledger sync of the order/delivery lifecycle (DELIVERY_TEST_SKIP_SYNC=1). `cookie` must be ADMIN/MANAGER.
 */
export async function deliverySyncSkipped(cookie: string): Promise<boolean> {
  const r = await call('GET', '/api/deliveries/qa-mode', cookie)
  if (r.status !== 200 || typeof r.json?.skipSync !== 'boolean') {
    throw new Error(`Dev server on ${BASE} did not answer /api/deliveries/qa-mode (${r.status} ${JSON.stringify(r.json)}): is it running (not in production mode)?`)
  }
  return r.json.skipSync
}

/**
 * Accounting QA scripts assert on journal entries posted by the hooks (confirm -> INVOICE, assign -> DELIVERY_COGS,
 * cancel -> removal). Those hooks go through lib/deliveries/sync.ts syncAfterCommit, which DELIVERY_TEST_SKIP_SYNC=1
 * turns off: refuse to run against a server started with that switch, or every ledger check would fail confusingly.
 */
export async function requireLedgerSyncOn(cookie: string): Promise<void> {
  if (await deliverySyncSkipped(cookie)) {
    throw new Error('Refusing to run: this script checks ledger postings, but the dev server was started with DELIVERY_TEST_SKIP_SYNC=1 (restart it without the switch)')
  }
}

/** The opposite guard: scripts that must NOT post to the live ledger (go-live is set on production). */
export async function requireLedgerSyncOff(cookie: string): Promise<void> {
  if (!(await deliverySyncSkipped(cookie))) {
    throw new Error('Refusing to run: start the dev server with DELIVERY_TEST_SKIP_SYNC=1 so confirming QA orders does not post to the live ledger')
  }
}

/** An active Employee with an assignee role (DRIVER/SALESMAN/SALES_REP/TEAM_LEAD). No login: an ADMIN cookie records outcomes. */
export function createQaAssignee(name: string, role: 'DRIVER' | 'SALESMAN' | 'SALES_REP' | 'TEAM_LEAD' = 'DRIVER') {
  return prisma.employee.create({ data: { name, role, isActive: true } })
}

/**
 * A delivery picture URL that passes isDeliveryPictureUrl (the outcome route only accepts pictures under the
 * retailer-photos bucket's delivery/ folder). Nothing is uploaded: the URL is well-formed but not backed by an object.
 * Null when NEXT_PUBLIC_SUPABASE_URL is not set (callers skip the Paid-in-Full checks then).
 */
export function qaDeliveryPictureUrl(name = 'qa_flow_proof.jpg'): string | null {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabase) return null
  return `${supabase.replace(/\/+$/, '')}/storage/v1/object/public/retailer-photos/delivery/${name}`
}

export const setOrderStatusApi = (orderId: string, status: string, cookie: string) =>
  call('PUT', `/api/orders/${orderId}/status`, cookie, { status })

/** RECEIVED -> INVOICED through the real status route (creates invoice + delivery + challan). */
export const confirmOrder = (orderId: string, cookie: string) => setOrderStatusApi(orderId, 'INVOICED', cookie)

export async function deliveryIdOf(orderId: string): Promise<string> {
  const d = await prisma.delivery.findUnique({ where: { orderId }, select: { id: true } })
  if (!d) throw new Error(`order ${orderId} has no delivery (confirm it first)`)
  return d.id
}

/** POST /api/deliveries/[id]/assign { driverId }: order -> OUT_FOR_DELIVERY, stock leaves FEFO, COGS dated assignedAt. */
export async function assignOrder(orderId: string, driverId: string, cookie: string): Promise<Res> {
  return call('POST', `/api/deliveries/${await deliveryIdOf(orderId)}/assign`, cookie, { driverId })
}

/** POST /api/deliveries/[id]/assign { unassign: true }: OUT_FOR_DELIVERY (no outcome) -> INVOICED, stock back. */
export async function unassignOrder(orderId: string, cookie: string): Promise<Res> {
  return call('POST', `/api/deliveries/${await deliveryIdOf(orderId)}/assign`, cookie, { unassign: true })
}

export async function recordOutcomeApi(orderId: string, cookie: string, body: Record<string, unknown>): Promise<Res> {
  return call('POST', `/api/deliveries/${await deliveryIdOf(orderId)}/outcome`, cookie, body)
}

/** Delivered, Pay Later: order + delivery DELIVERED (deliveredAt now), no collection, no stock change. */
export const payLater = (orderId: string, cookie: string) => recordOutcomeApi(orderId, cookie, { outcome: 'PAY_LATER' })

/** On Hold until `holdUntil` (Karachi YYYY-MM-DD, today or later); reason 'no cash' | 'shop closed'. Stock stays out. */
export const holdOrder = (orderId: string, cookie: string, holdUntil: string, reason = 'shop closed') =>
  recordOutcomeApi(orderId, cookie, { outcome: 'ON_HOLD', reason, holdUntil })

function must(label: string, r: Res): Res {
  if (r.status !== 200) throw new Error(`${label} failed: ${r.status} ${JSON.stringify(r.json)}`)
  return r
}

/** INVOICED -> OUT_FOR_DELIVERY, throwing on anything but 200. */
export async function mustAssign(orderId: string, driverId: string, cookie: string): Promise<Res> {
  return must(`assign of ${orderId}`, await assignOrder(orderId, driverId, cookie))
}

/** INVOICED -> OUT_FOR_DELIVERY -> DELIVERED (Pay Later), throwing on anything but 200. The old "status DELIVERED". */
export async function mustAssignAndPayLater(orderId: string, driverId: string, cookie: string): Promise<Res> {
  await mustAssign(orderId, driverId, cookie)
  return must(`Pay Later outcome of ${orderId}`, await payLater(orderId, cookie))
}
