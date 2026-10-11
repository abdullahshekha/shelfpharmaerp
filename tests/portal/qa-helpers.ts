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

// Exact names the QA scripts create — cleanup and the foreign-record guard are scoped to these only.
export const QA_RETAILER_NAMES = ['QA Portal Customer', 'QA Staff Portal Customer', 'QA Other Customer', 'QA Omit Test']
export const QA_EMPLOYEE_NAMES = ['QA Login Employee']
export const QA_AREA_NAMES = ['QA Portal Area']

/** Aborts if a retailer named 'QA ...' exists that the scripts did not create and that has orders/invoices (could be a real customer). */
export async function assertNoForeignQa() {
  const foreign = await prisma.retailer.findMany({
    where: { name: { startsWith: 'QA ' }, NOT: { name: { in: QA_RETAILER_NAMES } }, OR: [{ orders: { some: {} } }, { invoices: { some: {} } }] },
    select: { id: true, name: true },
  })
  if (foreign.length) throw new Error(`Refusing to run: non-QA-script retailer(s) with orders/invoices named 'QA ...': ${foreign.map(f => f.name).join(', ')}`)
}
export async function makeQaCustomer(opts: { customerType?: string | null; areaId?: string; username?: string; enabled?: boolean } = {}) {
  await assertNoForeignQa()
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
  const qaRetailers = await prisma.retailer.findMany({
    where: { name: { in: QA_RETAILER_NAMES }, OR: [{ portalUsername: { startsWith: 'qa-' } }, { portalUsername: null }] },
    select: { id: true },
  })
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
  await prisma.area.deleteMany({ where: { name: { in: QA_AREA_NAMES } } })
  await prisma.employee.deleteMany({ where: { name: { in: QA_EMPLOYEE_NAMES } } })
}

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
