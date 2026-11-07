/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration QA for the audit-log Prisma extension (lib/audit/extension.ts).
// PRODUCTION DB — creates only 'QA Audit ...' records, removes them and every AuditLog row that refers to them
// (with AUDIT_ALLOW_PURGE=1) in `finally`, then prints the leftover count (must be 0).
// Needs a dev server on :3100 for the forged-actor-header check. Run: npx tsx tests/audit/qa-audit.ts
import { prisma, staffCookie, check, BASE } from '../portal/qa-helpers'
import { encodeActor, ACTOR_HEADER } from '../../lib/audit/actor'

const START = new Date(Date.now() - 5000)
const ids = new Set<string>()
const track = <T extends { id: string }>(r: T) => { ids.add(r.id); return r }
const P = 'QA Audit'

const entries = (model: string, recordId: string) =>
  prisma.auditLog.findMany({ where: { model, recordId }, orderBy: { createdAt: 'asc' } })
const bulkSince = async (model: string, action: string, since: Date) =>
  prisma.auditLog.findMany({ where: { model, action, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' } })
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

  // ---- bulk ----
  const t0 = new Date()
  const cm = await prisma.area.createMany({ data: [1, 2, 3].map((i) => ({ name: `${P} Bulk ${i}` })) })
  const bulkAreas = await prisma.area.findMany({ where: { name: { startsWith: `${P} Bulk` } } })
  bulkAreas.forEach(track)
  let bulk = (await bulkSince('Area', 'BULK_CREATE', t0)).filter((e) => ((e.changes as any)?.ids ?? []).some((i: string) => ids.has(i)))
  check('createMany returns its count', cm.count === 3)
  check('createMany of 3 -> one BULK_CREATE with count 3 and the ids', bulk.length === 1 && (bulk[0].changes as any).count === 3 && (bulk[0].changes as any).ids.length === 3)

  const t1 = new Date()
  const um0 = await prisma.area.updateMany({ where: { name: `${P} Nothing Matches` }, data: { deliveryDays: [2] } })
  check('updateMany matching nothing -> no entry', um0.count === 0 && (await bulkSince('Area', 'BULK_UPDATE', t1)).length === 0)
  const um = await prisma.area.updateMany({ where: { name: { startsWith: `${P} Bulk` } }, data: { deliveryDays: [2] } })
  bulk = (await bulkSince('Area', 'BULK_UPDATE', t1)).filter((e) => ((e.changes as any)?.ids ?? []).some((i: string) => ids.has(i)))
  check('updateMany of 3 -> one BULK_UPDATE count 3', um.count === 3 && bulk.length === 1 && (bulk[0].changes as any).count === 3)

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
    data: { retailerId: ret.id, status: 'DRAFT', items: { create: [{ medicineId: med.id, quantity: 2, unitPrice: 10, lineTotal: 20 }, { medicineId: med.id, quantity: 1, unitPrice: 10, lineTotal: 10 }] } },
  }))
  es = await entries('Order', order.id)
  check('order CREATE entry holds the nested items', JSON.stringify((es[0]?.changes as any)?.items ?? '').includes('"quantity":2'))
  await prisma.order.delete({ where: { id: order.id } })
  es = await entries('Order', order.id)
  const od = es.find((e) => e.action === 'DELETE')
  check('order DELETE -> _cascaded holds the 2 items', ((od?.changes as any)?._cascaded?.OrderItem ?? []).length === 2, JSON.stringify((od?.changes as any)?._cascaded))

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

async function cleanup() {
  const areas = await prisma.area.findMany({ where: { name: { startsWith: P } }, select: { id: true } })
  areas.forEach((a) => ids.add(a.id))
  await prisma.order.deleteMany({ where: { retailer: { name: `${P} Customer` } } })
  await prisma.medicine.deleteMany({ where: { name: `${P} MED` } })
  await prisma.manufacturer.deleteMany({ where: { name: `${P} Mfr` } })
  await prisma.retailer.deleteMany({ where: { name: `${P} Customer` } })
  await prisma.employee.deleteMany({ where: { name: `${P} Employee` } })
  await prisma.area.deleteMany({ where: { name: { startsWith: P } } })
  // Our own audit rows: those whose recordId or bulk ids are records this run created.
  const mine = (await prisma.auditLog.findMany({ where: { createdAt: { gte: START } } }))
    .filter((e) => (e.recordId && ids.has(e.recordId)) || ((e.changes as any)?.ids ?? []).some((i: string) => ids.has(i)))
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
    (await prisma.auditLog.findMany({ where: { createdAt: { gte: START } } }))
      .filter((e) => (e.recordId && ids.has(e.recordId)) || ((e.changes as any)?.ids ?? []).some((i: string) => ids.has(i))).length
  console.log(`Leftover QA rows: ${left}`)
  if (left !== 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { try { await cleanup() } catch (e) { console.error('CLEANUP FAILED', e); process.exitCode = 1 } await prisma.$disconnect() })
