/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA for the audit-log Prisma extension (lib/audit/extension.ts).
// PRODUCTION DB — creates only 'QA Audit ...' records, removes them and every AuditLog row that refers to them
// (with AUDIT_ALLOW_PURGE=1) in `finally`, then prints the leftover count (must be 0).
// Needs a dev server on :3100 for the forged-actor-header check. Run: npx tsx tests/audit/qa-audit.ts
import { prisma, staffCookie, check, BASE } from '../portal/qa-helpers'
import { encodeActor, ACTOR_HEADER } from '../../lib/audit/actor'
import { hashPassword } from '../../lib/utils/auth'
import { hashPortalPassword } from '../../lib/utils/portal-auth'

const START = new Date(Date.now() - 5000)
const ids = new Set<string>()
const track = <T extends { id: string }>(r: T) => { ids.add(r.id); return r }
const P = 'QA Audit'
const LOGIN_USER = 'qa.audit.login'
const LOGIN_PW = 'qa-audit-pw-123'
const PORTAL_USER = 'qa.audit.portal'
const PORTAL_PW = 'qa-audit-portal-1'
const UNKNOWN_USER = 'qa.audit.nobody'
const GHOST_PORTAL = 'qa.audit.ghost'
const QA_LOGIN_NAMES = [LOGIN_USER, PORTAL_USER, UNKNOWN_USER, GHOST_PORTAL]

const entries = (model: string, recordId: string) =>
  prisma.auditLog.findMany({ where: { model, recordId }, orderBy: { createdAt: 'asc' } })
async function throws(fn: () => Promise<unknown>) { try { await fn(); return false } catch { return true } }

async function main() {
  if (await prisma.area.count({ where: { name: { startsWith: P } } })) throw new Error('QA residue from a previous run exists')

  // ---- create / update / no-op / delete ----
  const area = track(await prisma.area.create({ data: { name: `${P} Area` } }))
  let es = await entries('Area', area.id)
  check('create -> one CREATE entry with new values', es.length === 1 && es[0].action === 'CREATE' && (es[0].changes as any)?.name?.to === `${P} Area`, JSON.stringify(es.map((e) => e.action)))
  check('create entry actor is script', es[0]?.actorType === 'SYSTEM' && es[0]?.actorName === 'script')

  await prisma.area.update({ where: { id: area.id }, data: { deliveryDays: [1, 3] } })
  es = await entries('Area', area.id)
  const upd = es.filter((e) => e.action === 'UPDATE')
  check('update one field -> one UPDATE entry with exactly that field', upd.length === 1 && JSON.stringify(Object.keys(upd[0].changes as any)) === '["deliveryDays"]', JSON.stringify(upd.map((e) => e.changes)))

  await prisma.area.update({ where: { id: area.id }, data: { deliveryDays: [1, 3] } })
  check('no-op update -> no entry', (await entries('Area', area.id)).length === 2)

  await prisma.area.update({ where: { id: area.id }, data: { name: `${P} Area 2` }, select: { name: true } })
  es = await entries('Area', area.id)
  check('update with select still diffs the full row', es.length === 3 && JSON.stringify(Object.keys(es[2].changes as any)) === '["name"]', JSON.stringify(es[2]?.changes))

  const reads = await prisma.auditLog.count()
  await prisma.area.findMany({ where: { name: { startsWith: P } } })
  await prisma.area.count()
  check('reads write no entries', (await prisma.auditLog.count()) === reads)

  // ---- upsert ----
  const up1 = track(await prisma.area.upsert({ where: { name: `${P} Upsert` }, create: { name: `${P} Upsert` }, update: {} }))
  await prisma.area.upsert({ where: { name: `${P} Upsert` }, create: { name: `${P} Upsert` }, update: { deliveryDays: [5] } })
  es = await entries('Area', up1.id)
  check('upsert -> CREATE then UPDATE', es.map((e) => e.action).join(',') === 'CREATE,UPDATE', es.map((e) => e.action).join(','))

  // ---- delete ----
  const del = track(await prisma.area.create({ data: { name: `${P} Del` } }))
  await prisma.area.delete({ where: { id: del.id } })
  es = await entries('Area', del.id)
  const d = es.find((e) => e.action === 'DELETE')
  check('delete -> DELETE entry with old values', !!d && (d.changes as any)?.name?.from === `${P} Del` && (d.changes as any)?.name?.to === null)

  // ---- bulk: <= ROW_CAP rows -> per-row entries; above -> one BULK_* entry with a summary ----
  const cm = await prisma.area.createMany({ data: [1, 2, 3].map((i) => ({ name: `${P} Bulk ${i}` })) })
  const bulkAreas = await prisma.area.findMany({ where: { name: { startsWith: `${P} Bulk` } } })
  bulkAreas.forEach(track)
  const perRow = async (action: string) => (await prisma.auditLog.findMany({ where: { model: 'Area', action, recordId: { in: bulkAreas.map((a) => a.id) } } }))
  check('createMany returns its count', cm.count === 3)
  check('createMany of 3 -> 3 per-row CREATE entries with values', (await perRow('CREATE')).filter((e) => String((e.changes as any)?.name?.to).startsWith(`${P} Bulk`)).length === 3)

  const t1 = new Date()
  const um0 = await prisma.area.updateMany({ where: { name: `${P} Nothing Matches` }, data: { deliveryDays: [2] } })
  check('updateMany matching nothing -> no entry', um0.count === 0 && (await prisma.auditLog.count({ where: { model: 'Area', createdAt: { gte: t1 } } })) === 0)
  const um = await prisma.area.updateMany({ where: { name: { startsWith: `${P} Bulk` } }, data: { deliveryDays: [2] } })
  const ups = await perRow('UPDATE')
  check('updateMany of 3 -> 3 per-row UPDATE entries diffing deliveryDays', um.count === 3 && ups.length === 3 && ups.every((e) => JSON.stringify(e.changes) === '{"deliveryDays":{"to":[2],"from":[]}}'), JSON.stringify(ups.map((e) => e.changes)))
  await prisma.area.updateMany({ where: { name: { startsWith: `${P} Bulk` } }, data: { deliveryDays: [2] } })
  check('no-op updateMany -> no new entries', (await perRow('UPDATE')).length === 3)
  const dm = await prisma.area.deleteMany({ where: { name: `${P} Bulk 3` } })
  const dels = await perRow('DELETE')
  check('deleteMany of 1 -> per-row DELETE with old values', dm.count === 1 && dels.length === 1 && (dels[0].changes as any)?.name?.from === `${P} Bulk 3`)

  const t2 = new Date()
  const big = await prisma.area.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ name: `${P} Big ${i}` })) })
  const bigAreas = await prisma.area.findMany({ where: { name: { startsWith: `${P} Big` } } })
  bigAreas.forEach(track)
  const bigCreate = await prisma.auditLog.findMany({ where: { model: 'Area', createdAt: { gte: t2 } } })
  check('createMany of 30 (> 25) -> one BULK_CREATE with count + data sample', big.count === 30 && bigCreate.length === 1 && bigCreate[0].action === 'BULK_CREATE' && (bigCreate[0].changes as any).count === 30 && JSON.stringify((bigCreate[0].changes as any).data?.sample ?? null).includes(`${P} Big`), JSON.stringify(bigCreate.map((e) => [e.action, e.changes])).slice(0, 300))
  const bigUpd = await prisma.area.updateMany({ where: { name: { startsWith: `${P} Big` } }, data: { deliveryDays: [3] } })
  const bu = await prisma.auditLog.findMany({ where: { model: 'Area', action: 'BULK_UPDATE', createdAt: { gte: t2 } } })
  check('updateMany of 30 -> one BULK_UPDATE with count, ids, where and data', bigUpd.count === 30 && bu.length === 1 && (bu[0].changes as any).count === 30 && (bu[0].changes as any).ids.length === 30 && JSON.stringify((bu[0].changes as any).data) === '{"deliveryDays":[3]}')
  const bigDel = await prisma.area.deleteMany({ where: { name: { startsWith: `${P} Big` } } })
  const bd = await prisma.auditLog.findMany({ where: { model: 'Area', action: 'BULK_DELETE', createdAt: { gte: t2 } } })
  check('deleteMany of 30 -> one BULK_DELETE with count + where', bigDel.count === 30 && bd.length === 1 && (bd[0].changes as any).count === 30 && !!(bd[0].changes as any).where)

  // ---- redaction ----
  const emp = track(await prisma.employee.create({ data: { name: `${P} Employee`, role: 'WAREHOUSE', passwordHash: 'secret-hash-value' } }))
  es = await entries('Employee', emp.id)
  check('Employee passwordHash -> [hidden]', (es[0]?.changes as any)?.passwordHash?.to === '[hidden]' && !JSON.stringify(es[0]?.changes ?? null).includes('secret-hash-value'))

  // ---- noise-only retailer update ----
  const ret = track(await prisma.retailer.create({ data: { name: `${P} Customer`, drugLicenses: { create: [{ licenseNumber: 'QA-LIC-1' }] } } }))
  const before = (await entries('Retailer', ret.id)).length
  await prisma.retailer.update({ where: { id: ret.id }, data: { portalFailedAttempts: { increment: 1 } } })
  check('updating only portalFailedAttempts -> no entry', (await entries('Retailer', ret.id)).length === before)
  check('nested create (drug license) appears in the parent CREATE entry', JSON.stringify((await entries('Retailer', ret.id))[0]?.changes ?? null).includes('QA-LIC-1'))

  // ---- order with items: nested create + cascade snapshot on delete ----
  const mfr = track(await prisma.manufacturer.create({ data: { name: `${P} Mfr` } }))
  const med = track(await prisma.medicine.create({ data: { code: `QAAUD${Date.now() % 100000}`, name: `${P} MED`, manufacturerId: mfr.id } }))
  const order = track(await prisma.order.create({
    data: { retailerId: ret.id, status: 'RECEIVED', items: { create: [{ medicineId: med.id, quantity: 2, unitPrice: 10, lineTotal: 20 }, { medicineId: med.id, quantity: 1, unitPrice: 10, lineTotal: 10 }] } },
  }))
  es = await entries('Order', order.id)
  check('order CREATE entry holds the nested items', JSON.stringify((es[0]?.changes as any)?.items ?? '').includes('"quantity":2'))
  await prisma.order.delete({ where: { id: order.id } })
  es = await entries('Order', order.id)
  const od = es.find((e) => e.action === 'DELETE')
  check('order DELETE -> _cascaded holds the 2 items', ((od?.changes as any)?._cascaded?.OrderItem ?? []).length === 2, JSON.stringify((od?.changes as any)?._cascaded))

  // ---- real order flows (lib/orders): DELIVERED, cancel, hard delete -> order History ----
  // Zero prices and a pre-go-live payment date keep the live ledger untouched apart from zero-value postings that
  // the hard delete's sync removes again (checked in cleanup).
  const { setOrderStatus } = await import('../../lib/orders/set-status')
  const { cancelOrder, hardDeleteOrder } = await import('../../lib/orders/lifecycle')
  const { GET: historyGET } = await import('../../app/api/orders/[id]/history/route')
  const { NextRequest } = await import('next/server')
  const history = async (id: string) => {
    const res = await historyGET(new NextRequest(`http://x/api/orders/${id}/history`, { headers: { cookie: staffCookie('ADMIN') } }), { params: Promise.resolve({ id }) } as any)
    return ((await res.json()).data ?? []) as any[]
  }
  const batch = track(await prisma.medicineBatch.create({ data: { medicineId: med.id, batchNumber: 'QA-AUDIT-B1', expiryDate: new Date('2031-01-01'), quantityIn: 10, currentQty: 10, purchasePrice: 0, tradePrice: 0 } }))
  const flow = track(await prisma.order.create({
    data: { retailerId: ret.id, status: 'RECEIVED', items: { create: [{ medicineId: med.id, quantity: 2, unitPrice: 0, lineTotal: 0 }] } },
    include: { items: true },
  }))
  flow.items.forEach(track)
  await setOrderStatus(flow.id, 'INVOICED')
  const inv = track((await prisma.invoice.findUnique({ where: { orderId: flow.id } }))!)
  track((await prisma.delivery.findUnique({ where: { orderId: flow.id } }))!)
  track((await prisma.deliveryChallan.findUnique({ where: { orderId: flow.id } }))!)
  const pay = track(await prisma.payment.create({ data: { retailerId: ret.id, invoiceId: inv.id, amount: 1, paymentDate: new Date('2026-01-01T00:00:00Z'), notes: 'QA Audit payment' } }))
  await setOrderStatus(flow.id, 'DELIVERED')
  let h = await history(flow.id)
  const changed = (model: string, field: string, to: unknown) => h.some((e) => e.model === model && e.action === 'UPDATE' && e.changes?.[field]?.to === to)
  check('History: Order status -> DELIVERED (updateMany claim)', changed('Order', 'status', 'DELIVERED'), JSON.stringify(h.map((e) => [e.model, e.action, Object.keys(e.changes ?? {})])))
  check('History: Delivery status -> DELIVERED', changed('Delivery', 'status', 'DELIVERED'))
  check('History: stock deduction recorded on the order item', h.some((e) => e.model === 'OrderItem' && e.action === 'UPDATE' && e.changes?.deductedQty?.to === 2))
  check('stock deducted from the QA batch', (await prisma.medicineBatch.findUnique({ where: { id: batch.id } }))!.currentQty === 8)
  await cancelOrder(flow.id)
  h = await history(flow.id)
  check('History: cancel -> Order status DELIVERED -> CANCELLED', h.some((e) => e.model === 'Order' && e.action === 'UPDATE' && e.changes?.status?.from === 'DELIVERED' && e.changes?.status?.to === 'CANCELLED'))
  await hardDeleteOrder(flow.id)
  h = await history(flow.id)
  const del1 = (model: string) => h.find((e) => e.model === model && e.action === 'DELETE')
  check('History after hard delete: Order DELETE with old values + cascaded items', del1('Order')?.changes?.status?.from === 'CANCELLED' && (del1('Order')?.changes?._cascaded?.OrderItem ?? []).length === 1, JSON.stringify(h.map((e) => [e.model, e.action])))
  check('History after hard delete: Payment DELETE with old values', del1('Payment')?.recordId === pay.id && del1('Payment')?.changes?.amount?.from === '1')
  check('History after hard delete: Invoice, Delivery, DeliveryChallan DELETE', !!del1('Invoice') && !!del1('Delivery') && !!del1('DeliveryChallan'))
  check('History after hard delete still shows the DELIVERED change', changed('Order', 'status', 'DELIVERED'))

  // ---- customer quantity sheet PUT (was an array $transaction of upserts; now interactive) ----
  const ol = track(await prisma.offerList.create({ data: { name: `${P} Offer List`, listNumber: `QA-AUDIT-${Date.now()}`, listDate: new Date() } }))
  const sheet = track(await prisma.offerListCustomer.create({ data: { offerListId: ol.id, retailerId: ret.id } }))
  const med2 = track(await prisma.medicine.create({ data: { code: `QAAUE${Date.now() % 100000}`, name: `${P} MED`, manufacturerId: mfr.id } }))
  const { PUT } = await import('../../app/api/offer-list/[id]/customers/[customerId]/route')
  const putSheet = (items: unknown[]) => PUT(new Request('http://x/api', { method: 'PUT', body: JSON.stringify({ items }) }) as any, { params: Promise.resolve({ id: ol.id, customerId: sheet.id }) } as any)
  const r1 = await putSheet([{ medicineId: med.id, quantity: 3 }, { medicineId: med2.id, quantity: 5 }])
  const r2 = await putSheet([{ medicineId: med.id, quantity: 4 }])
  const lines = await prisma.offerListCustomerItem.findMany({ where: { offerListCustomerId: sheet.id }, orderBy: { quantity: 'asc' } })
  lines.forEach(track)
  check('quantity sheet PUT saves (200, upserts applied)', r1.status === 200 && r2.status === 200 && lines.map((l) => l.quantity).join(',') === '4,5', `${r1.status} ${r2.status} ${lines.map((l) => l.quantity)}`)
  const lineAudit = await prisma.auditLog.findMany({ where: { model: 'OfferListCustomerItem', recordId: { in: lines.map((l) => l.id) } } })
  check('quantity sheet upserts are audited (2 CREATE + 1 UPDATE)', lineAudit.map((e) => e.action).sort().join(',') === 'CREATE,CREATE,UPDATE', lineAudit.map((e) => e.action).join(','))

  // ---- append-only ----
  const anyEntry = (await entries('Area', area.id))[0]
  check('auditLog.update throws', await throws(() => prisma.auditLog.update({ where: { id: anyEntry.id }, data: { reason: 'x' } })))
  check('auditLog.deleteMany throws', await throws(() => prisma.auditLog.deleteMany({ where: { id: anyEntry.id } })))
  check('entry still there after refused delete', (await prisma.auditLog.count({ where: { id: anyEntry.id } })) === 1)

  // ---- array $transaction: reads fine, writes refused (fail closed) ----
  const arr = await prisma.$transaction([prisma.area.count(), prisma.area.findFirst({ where: { id: area.id } })])
  check('array $transaction of reads works', arr[1]?.id === area.id)
  check('array $transaction with a write is refused', await throws(() => prisma.$transaction([prisma.area.create({ data: { name: `${P} Batch` } })])))
  check('...and nothing was written', (await prisma.area.count({ where: { name: `${P} Batch` } })) === 0)

  // ---- interactive transaction: logged inside, rolled back together ----
  const itx = await prisma.$transaction(async (tx) => track(await tx.area.create({ data: { name: `${P} Itx` } })))
  check('write inside $transaction is logged', (await entries('Area', itx.id)).length === 1)
  await prisma.$transaction(async (tx) => {
    await tx.area.update({ where: { id: itx.id }, data: { deliveryDays: [4] } })
    await tx.$transaction(async (inner) => { await inner.area.update({ where: { id: itx.id }, data: { deliveryDays: [4, 6] } }) })
  })
  check('nested $transaction writes are logged', (await entries('Area', itx.id)).length === 3)
  await throws(() => prisma.$transaction(async (tx) => {
    await tx.area.update({ where: { id: itx.id }, data: { name: `${P} Itx Renamed` } })
    throw new Error('business failure')
  }))
  check('business rollback also rolls back its audit entry', (await entries('Area', itx.id)).length === 3)
  await prisma.$transaction(async (tx) => {
    await tx.area.update({ where: { id: itx.id }, data: { deliveryDays: [1] } })
    await tx.$transaction(async (inner) => {
      await inner.area.update({ where: { id: itx.id }, data: { name: `${P} Itx Savepoint` } })
      throw new Error('savepoint failure')
    }).catch(() => null)
  })
  es = await entries('Area', itx.id)
  check('caught savepoint rollback discards its entry; the outer write is logged', es.length === 4 && JSON.stringify(es[3].changes) === '{"deliveryDays":{"to":[1],"from":[4,6]}}' && (await prisma.area.findUnique({ where: { id: itx.id } }))!.name === `${P} Itx`, JSON.stringify(es.map((e) => e.changes)))
  const many = await prisma.$transaction(async (tx) => {
    const a = track(await tx.area.create({ data: { name: `${P} Buf A` } }))
    const b = track(await tx.area.create({ data: { name: `${P} Buf B` } }))
    // Not visible before the flush at the end of the transaction callback.
    const inside = await tx.auditLog.count({ where: { recordId: { in: [a.id, b.id] } } })
    return { a, b, inside }
  })
  check('entries are buffered and flushed once at the end of the transaction', many.inside === 0 && (await prisma.auditLog.count({ where: { recordId: { in: [many.a.id, many.b.id] } } })) === 2)

  // ---- forced audit failure: the change fails too ----
  process.env.AUDIT_TEST_FAIL = '1'
  try {
    const plainThrew = await throws(() => prisma.area.create({ data: { name: `${P} Fail Plain` } }))
    check('forced audit failure (plain) -> write throws', plainThrew)
    check('forced audit failure (plain) -> area NOT created', (await prisma.area.count({ where: { name: `${P} Fail Plain` } })) === 0)
    const itxThrew = await throws(() => prisma.$transaction(async (tx) => { await tx.area.create({ data: { name: `${P} Fail Itx` } }) }))
    check('forced audit failure ($transaction) -> throws', itxThrew)
    check('forced audit failure ($transaction) -> area NOT created', (await prisma.area.count({ where: { name: `${P} Fail Itx` } })) === 0)
    check('forced audit failure (update) -> value unchanged', await throws(() => prisma.area.update({ where: { id: area.id }, data: { deliveryDays: [0] } })) &&
      JSON.stringify((await prisma.area.findUnique({ where: { id: area.id } }))!.deliveryDays) === '[1,3]')
  } finally {
    delete process.env.AUDIT_TEST_FAIL
  }

  // ---- login events ----
  try {
    const t = new Date()
    const post = (path: string, body: unknown) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const loginRows = async (model: string, action: string, username: string) =>
      (await prisma.auditLog.findMany({ where: { model, action, createdAt: { gte: t } }, orderBy: { createdAt: 'asc' } })).filter((e) => (e.changes as any)?.username === username)
    const lemp = track(await prisma.employee.create({ data: { name: `${P} Login Employee`, role: 'WAREHOUSE', username: LOGIN_USER, passwordHash: hashPassword(LOGIN_PW) } }))

    let r = await post('/api/auth/login', { username: LOGIN_USER, password: 'wrong-password-xyz' })
    let rows = await loginRows('Employee', 'LOGIN_FAILED', LOGIN_USER)
    check('staff wrong password -> 401 + LOGIN_FAILED with username, recordId, reason invalid', r.status === 401 && rows.length === 1 && rows[0].recordId === lemp.id && (rows[0].changes as any).reason === 'invalid', `${r.status} ${JSON.stringify(rows.map((e) => e.changes))}`)
    check('staff failed login never stores the password', !JSON.stringify(rows.map((e) => e.changes)).includes('wrong-password-xyz'))

    r = await post('/api/auth/login', { username: LOGIN_USER, password: LOGIN_PW })
    const okRows = await prisma.auditLog.findMany({ where: { model: 'Employee', action: 'LOGIN', recordId: lemp.id, createdAt: { gte: t } } })
    check('staff correct password -> 200 + LOGIN with employee actor', r.status === 200 && okRows.length === 1 && okRows[0].actorType === 'EMPLOYEE' && okRows[0].actorId === lemp.id && okRows[0].actorName === `${P} Login Employee`, `${r.status} ${JSON.stringify(okRows.map((e) => [e.actorType, e.actorId, e.actorName]))}`)
    check('staff LOGIN entry never stores the password', !JSON.stringify(okRows.map((e) => e.changes)).includes(LOGIN_PW))

    r = await post('/api/auth/login', { username: UNKNOWN_USER, password: 'whatever-pw-1' })
    rows = await loginRows('Employee', 'LOGIN_FAILED', UNKNOWN_USER)
    check('staff unknown username -> LOGIN_FAILED with recordId null, SYSTEM actor', r.status === 401 && rows.length === 1 && rows[0].recordId === null && rows[0].actorType === 'SYSTEM' && !JSON.stringify(rows[0].changes).includes('whatever-pw-1'), `${r.status} ${JSON.stringify(rows.map((e) => [e.recordId, e.actorType, e.changes]))}`)

    await prisma.employee.update({ where: { id: lemp.id }, data: { loginBlocked: true } })
    r = await post('/api/auth/login', { username: LOGIN_USER, password: LOGIN_PW })
    rows = (await loginRows('Employee', 'LOGIN_FAILED', LOGIN_USER)).filter((e) => (e.changes as any).reason === 'blocked')
    check('staff blocked account -> 403 + LOGIN_FAILED reason blocked', r.status === 403 && rows.length === 1 && rows[0].recordId === lemp.id, `${r.status} ${rows.length}`)

    const pret = track(await prisma.retailer.create({ data: { name: `${P} Portal Customer`, portalUsername: PORTAL_USER, portalPasswordHash: hashPortalPassword(PORTAL_PW), portalEnabled: true } }))
    r = await post('/api/portal/login', { username: PORTAL_USER, password: 'bad-portal-pw-9' })
    rows = await loginRows('Retailer', 'LOGIN_FAILED', PORTAL_USER)
    check('portal wrong password -> 401 + LOGIN_FAILED invalid, CUSTOMER actor', r.status === 401 && rows.length === 1 && rows[0].recordId === pret.id && rows[0].actorType === 'CUSTOMER' && (rows[0].changes as any).reason === 'invalid' && !JSON.stringify(rows[0].changes).includes('bad-portal-pw-9'), `${r.status} ${JSON.stringify(rows.map((e) => [e.actorType, e.changes]))}`)

    r = await post('/api/portal/login', { username: GHOST_PORTAL, password: 'bad-portal-pw-9' })
    rows = await loginRows('Retailer', 'LOGIN_FAILED', GHOST_PORTAL)
    check('portal unknown username -> LOGIN_FAILED invalid, recordId null, SYSTEM actor', r.status === 401 && rows.length === 1 && rows[0].recordId === null && rows[0].actorType === 'SYSTEM' && (rows[0].changes as any).reason === 'invalid', `${r.status} ${JSON.stringify(rows.map((e) => [e.actorType, e.changes]))}`)

    r = await post('/api/portal/login', { username: PORTAL_USER, password: PORTAL_PW })
    const pok = await prisma.auditLog.findMany({ where: { model: 'Retailer', action: 'LOGIN', recordId: pret.id, createdAt: { gte: t } } })
    check('portal correct password -> 200 + LOGIN, CUSTOMER actor with retailer name', r.status === 200 && pok.length === 1 && pok[0].actorType === 'CUSTOMER' && pok[0].actorId === pret.id && pok[0].actorName === `${P} Portal Customer`, `${r.status} ${JSON.stringify(pok.map((e) => [e.actorType, e.actorId, e.actorName]))}`)

    // lock: counter is 1 after the wrong attempt above reset to 0 on success; 5 wrong attempts -> 5th locks, 6th hits the early exit
    let last = 0
    for (let i = 0; i < 5; i++) last = (await post('/api/portal/login', { username: PORTAL_USER, password: 'bad-portal-pw-9' })).status
    const r6 = await post('/api/portal/login', { username: PORTAL_USER, password: 'bad-portal-pw-9' })
    rows = (await loginRows('Retailer', 'LOGIN_FAILED', PORTAL_USER)).filter((e) => (e.changes as any).reason === 'locked')
    check('portal lock -> 429 on 5th attempt and on the next, each logged reason locked', last === 429 && r6.status === 429 && rows.length === 2, `${last} ${r6.status} ${rows.length}`)

    // attempted username is bounded to 64 chars
    const longName = 'qa.audit.' + 'x'.repeat(200)
    await post('/api/auth/login', { username: longName, password: 'whatever-pw-1' })
    const longRows = (await prisma.auditLog.findMany({ where: { model: 'Employee', action: 'LOGIN_FAILED', createdAt: { gte: t } } })).filter((e) => String((e.changes as any)?.username ?? '').startsWith('qa.audit.xxxx'))
    check('staff attempted username truncated to 64 chars', longRows.length === 1 && (longRows[0].changes as any).username.length === 64, JSON.stringify(longRows.map((e) => String((e.changes as any).username).length)))
    longRows.forEach((e) => ids.add(e.id))

    // a failing login-event insert must not alter the login response and must write nothing.
    // Routes are called in-process with the test-only switch (the dev server's env is not ours to change).
    const countLogins = (recordId: string) => prisma.auditLog.count({ where: { recordId, action: { in: ['LOGIN', 'LOGIN_FAILED'] }, createdAt: { gte: t } } })
    await prisma.employee.update({ where: { id: lemp.id }, data: { loginBlocked: false } })
    await prisma.retailer.update({ where: { id: pret.id }, data: { portalLockedUntil: null, portalFailedAttempts: 0 } })
    const sBefore = await countLogins(lemp.id)
    const pBefore = await countLogins(pret.id)
    process.env.AUDIT_TEST_FAIL_EVENT = '1'
    const origErr = console.error
    console.error = () => {}
    try {
      const { POST: staffPost } = await import('../../app/api/auth/login/route')
      const { POST: portalPost } = await import('../../app/api/portal/login/route')
      const mk = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }) as any
      const sOk = await staffPost(mk({ username: LOGIN_USER, password: LOGIN_PW }))
      const sOkBody = await sOk.json()
      check('audit failure: staff success unchanged (200, success body, session cookie)', sOk.status === 200 && sOkBody.success === true && !!sOk.cookies.get('sp_session')?.value, `${sOk.status} ${JSON.stringify(sOkBody)}`)
      const sBad = await staffPost(mk({ username: LOGIN_USER, password: 'wrong-pw-zzz' }))
      check('audit failure: staff wrong password unchanged (401, no cookie)', sBad.status === 401 && (await sBad.json()).error === 'Invalid username or password' && !sBad.cookies.get('sp_session'))
      const pOk = await portalPost(mk({ username: PORTAL_USER, password: PORTAL_PW }))
      const pOkBody = await pOk.json()
      check('audit failure: portal success unchanged (200, success body, session cookie)', pOk.status === 200 && pOkBody.success === true && !!pOk.cookies.get('sp_customer')?.value, `${pOk.status} ${JSON.stringify(pOkBody)}`)
      const pBad = await portalPost(mk({ username: PORTAL_USER, password: 'wrong-pw-zzz' }))
      check('audit failure: portal wrong password unchanged (401, no cookie)', pBad.status === 401 && !pBad.cookies.get('sp_customer'))
    } finally {
      console.error = origErr
      delete process.env.AUDIT_TEST_FAIL_EVENT
    }
    check('audit failure: no login rows were written', (await countLogins(lemp.id)) === sBefore && (await countLogins(pret.id)) === pBefore)
  } catch (e) {
    check('login events block ran', false, String(e))
  }

  // ---- read APIs (Admin only) ----
  try {
    const orderNumber = `SP-19990101-${String(Date.now() % 10000).padStart(4, '0')}`
    const ho = track(await prisma.order.create({
      data: { retailerId: ret.id, orderNumber, status: 'RECEIVED', items: { create: [{ medicineId: med.id, quantity: 2, unitPrice: 10, lineTotal: 20 }] } },
      include: { items: true },
    }))
    const item = track((ho as any).items[0])
    await prisma.orderItem.update({ where: { id: item.id }, data: { quantity: 7 } })
    const get = (path: string, role: 'ADMIN' | 'MANAGER') => fetch(`${BASE}${path}`, { headers: { cookie: staffCookie(role) } })
    const hPath = `/api/orders/${ho.id}/history`
    check('MANAGER gets 403 from order history', (await get(hPath, 'MANAGER')).status === 403)
    check('MANAGER gets 403 from audit log', (await get('/api/audit-log', 'MANAGER')).status === 403)
    const hr = await get(hPath, 'ADMIN')
    const hj: any = await hr.json()
    const hrows: any[] = hj.data ?? []
    check('ADMIN order history 200 with the order CREATE and the item edit', hr.status === 200 &&
      hrows.some((e) => e.model === 'Order' && e.recordId === ho.id && e.action === 'CREATE') &&
      hrows.some((e) => e.model === 'OrderItem' && e.recordId === item.id && e.action === 'UPDATE' && e.changes?.quantity?.to === 7), `${hr.status} ${JSON.stringify(hrows.map((e) => [e.model, e.action]))}`)
    check('order history is newest first', hrows.every((e, i) => i === 0 || new Date(hrows[i - 1].createdAt) >= new Date(e.createdAt)))
    check('history rows have ISO createdAt string', typeof hrows[0]?.createdAt === 'string' && !Number.isNaN(Date.parse(hrows[0].createdAt)))

    const q1: any = await (await get(`/api/audit-log?q=${orderNumber}`, 'ADMIN')).json()
    check('audit-log q=order number finds order + item entries', q1.data?.some((e: any) => e.recordId === ho.id) && q1.data?.some((e: any) => e.recordId === item.id) && q1.meta?.total === q1.data?.length, JSON.stringify(q1.meta))
    const q2: any = await (await get(`/api/audit-log?q=${item.id}`, 'ADMIN')).json()
    check('audit-log q=record id is exact', q2.data?.length >= 1 && q2.data.every((e: any) => e.recordId === item.id))
    const q3: any = await (await get('/api/audit-log?q=SP-19990101-NOPE', 'ADMIN')).json()
    check('audit-log q=unknown order number -> empty', q3.data?.length === 0 && q3.meta?.total === 0)
    const f1: any = await (await get(`/api/audit-log?model=OrderItem&action=UPDATE&q=${orderNumber}&pageSize=1`, 'ADMIN')).json()
    check('audit-log filters + pageSize paginate', f1.data?.length === 1 && f1.meta.pageSize === 1 && f1.meta.total === 1 && f1.data[0].action === 'UPDATE')
    const big: any = await (await get('/api/audit-log?pageSize=9999', 'ADMIN')).json()
    check('pageSize capped at 200, default meta', big.meta?.pageSize === 200 && big.meta.page === 1 && big.data.length <= 200)
    const far: any = await (await get('/api/audit-log?page=999999999', 'ADMIN')).json()
    check('page clamped at 100000', far.meta?.page === 100000)
    const longQ = await get(`/api/audit-log?q=${'x'.repeat(5000)}`, 'ADMIN')
    check('very long q is accepted (capped), not an error', longQ.status === 200)
    const today = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10)
    const d1: any = await (await get(`/api/audit-log?from=${today}&to=${today}&q=${orderNumber}`, 'ADMIN')).json()
    check('audit-log date range (Karachi today) includes fresh entries', d1.meta?.total >= 2, JSON.stringify(d1.meta))
    const d2: any = await (await get(`/api/audit-log?to=2000-01-01&q=${orderNumber}`, 'ADMIN')).json()
    check('audit-log date range in the past excludes them', d2.meta?.total === 0)
    check('audit-log bad date -> 400', (await get('/api/audit-log?from=garbage', 'ADMIN')).status === 400)

    await prisma.order.delete({ where: { id: ho.id } })
    const hr2: any = await (await get(hPath, 'ADMIN')).json()
    check('history of a deleted order still shows its DELETE entry with cascaded items', hr2.data?.some((e: any) => e.model === 'Order' && e.action === 'DELETE' && e.changes?._cascaded?.OrderItem?.length === 1))
  } catch (e) {
    check('read APIs block ran', false, String(e))
  }

  // ---- HTTP: a forged x-sp-actor header is replaced by the real session actor ----
  try {
    const res = await fetch(`${BASE}/api/areas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: staffCookie('ADMIN'), [ACTOR_HEADER]: encodeActor({ type: 'EMPLOYEE', id: 'forged-id', name: 'Forged Person', role: 'ADMIN' }) },
      body: JSON.stringify({ name: `${P} Http` }),
    })
    const body = await res.json().catch(() => null)
    if (body?.data?.id) track(body.data)
    es = body?.data?.id ? await entries('Area', body.data.id) : []
    check('HTTP create logged with the session actor, not the forged header', res.status === 201 && es.length === 1 && es[0].actorId === 'qa' && es[0].actorName === 'QA' && es[0].actorType === 'EMPLOYEE', `${res.status} ${JSON.stringify(es.map((e) => [e.actorType, e.actorId, e.actorName]))}`)
  } catch (e) {
    check('HTTP create logged with the session actor (dev server on :3100 reachable)', false, String(e))
  }
}

/** An AuditLog row this run produced: about a record it created, or mentioning one / a QA name in its values. */
function ours(e: { recordId: string | null; changes: unknown }) {
  if (e.recordId && ids.has(e.recordId)) return true
  const text = JSON.stringify(e.changes ?? null)
  if (text.includes('QA Audit') || text.includes('QA-AUDIT')) return true
  return Array.from(ids).some((id) => text.includes(id))
}

async function cleanup() {
  const areas = await prisma.area.findMany({ where: { name: { startsWith: P } }, select: { id: true } })
  areas.forEach((a) => ids.add(a.id))
  const qaOrders = (await prisma.order.findMany({ where: { retailer: { name: `${P} Customer` } }, select: { id: true } })).map((o) => o.id)
  qaOrders.forEach((id) => ids.add(id))
  await prisma.payment.deleteMany({ where: { retailer: { name: `${P} Customer` } } })
  await prisma.delivery.deleteMany({ where: { orderId: { in: qaOrders } } })
  await prisma.deliveryChallan.deleteMany({ where: { orderId: { in: qaOrders } } })
  await prisma.invoice.deleteMany({ where: { orderId: { in: qaOrders } } })
  await prisma.order.deleteMany({ where: { retailer: { name: `${P} Customer` } } })
  // Ledger: any posting for a QA source (the records are gone now, so a sync removes it).
  const { syncAllSafe } = await import('../../lib/accounting/sync')
  const jes = await prisma.journalEntry.findMany({ where: { sourceId: { in: Array.from(ids) } }, select: { sourceType: true, sourceId: true } })
  if (jes.length) await syncAllSafe(jes.map((e) => [e.sourceType as any, e.sourceId]))
  await prisma.medicineBatch.deleteMany({ where: { medicine: { name: `${P} MED` } } })
  await prisma.offerList.deleteMany({ where: { listNumber: { startsWith: 'QA-AUDIT-' } } }) // cascades sheets + lines
  await prisma.medicine.deleteMany({ where: { name: `${P} MED` } })
  await prisma.manufacturer.deleteMany({ where: { name: `${P} Mfr` } })
  await prisma.retailer.deleteMany({ where: { name: { in: [`${P} Customer`, `${P} Portal Customer`] } } })
  await prisma.employee.deleteMany({ where: { name: { in: [`${P} Employee`, `${P} Login Employee`] } } })
  await prisma.area.deleteMany({ where: { name: { startsWith: P } } })
  // Our own audit rows: those whose recordId or bulk ids are records this run created.
  const mineOf = async () => (await prisma.auditLog.findMany({ where: { createdAt: { gte: START } } }))
    .filter((e) => ours(e) || String((e.changes as any)?.username ?? '').startsWith('qa.audit.'))
  const mine = await mineOf()
  process.env.AUDIT_ALLOW_PURGE = '1'
  try {
    if (mine.length) await prisma.auditLog.deleteMany({ where: { id: { in: mine.map((e) => e.id) } } })
  } finally {
    delete process.env.AUDIT_ALLOW_PURGE
  }
  const left =
    (await prisma.area.count({ where: { name: { startsWith: P } } })) +
    (await prisma.retailer.count({ where: { name: { startsWith: P } } })) +
    (await prisma.employee.count({ where: { name: { startsWith: P } } })) +
    (await prisma.manufacturer.count({ where: { name: { startsWith: P } } })) +
    (await prisma.medicine.count({ where: { name: { startsWith: P } } })) +
    (await prisma.offerList.count({ where: { listNumber: { startsWith: 'QA-AUDIT-' } } })) +
    (await prisma.journalEntry.count({ where: { sourceId: { in: Array.from(ids) } } })) +
    (await mineOf()).length
  console.log(`Leftover QA rows: ${left}`)
  if (left !== 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { try { await cleanup() } catch (e) { console.error('CLEANUP FAILED', e); process.exitCode = 1 } await prisma.$disconnect() })
