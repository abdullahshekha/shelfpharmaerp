/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from '@prisma/client'
import { getCurrentActor, type AuditActor } from './actor'
import { CASCADE_CHILDREN, CASCADE_SNAPSHOT_CAP } from './cascade'
import { REDACTED_FIELDS, shouldAuditModel, shouldAuditRow } from './config'
import { diffRecords, isNoiseOnly, redact, toJsonSafe } from './diff'

/*
 * Audit extension — every create/update/upsert/delete (single and bulk) writes one AuditLog row
 * IN THE SAME DATABASE TRANSACTION as the business write, so both commit or both roll back.
 *
 * Mechanism (proved by the Task 3 spike, Prisma 7 + adapter-pg):
 * - A write that is not already in an interactive transaction is re-issued inside one:
 *   `inner.$transaction(tx => tx[model][op](args))`. That re-enters this hook with a transaction.
 * - A write inside an interactive transaction carries `__internalParams.transaction = { kind: 'itx', id }`.
 *   The hook looks the transaction client up by that id in `txClients` and runs its before-read and
 *   the audit insert on it, i.e. on the same connection/transaction (no second connection => no deadlock).
 * - `txClients` is filled by our own wrapper above and by the `$transaction` override on the exported
 *   client. Nested `tx.$transaction` reuses the outer transaction id (savepoint), so it resolves too.
 * - Array (batch) transactions cannot run extra queries, so audited writes in them are refused.
 * Reads and excluded models go straight to `query(args)` — no extra queries.
 */

const SCOPE = Symbol.for('prisma.client.transaction.scope_context')
const WRITE_OPS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany',
])
const AUDIT_LOG_MUTATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany'])
const BULK_ID_CAP = 500
// Plain (non-transactional) writes get wrapped in a transaction; generous limits since they had none before.
const WRAP_TX_OPTS = { maxWait: 10000, timeout: 30000 }

const delegateKey = (model: string) => model.charAt(0).toLowerCase() + model.slice(1)
const txIdOf = (tx: any): string | undefined => tx?.[SCOPE]?.txId

/** model -> relation field -> related model (from the generated client's reduced DMMF). */
const RELATIONS: Record<string, Record<string, string>> = {}
for (const m of Prisma.dmmf.datamodel.models) {
  RELATIONS[m.name] = {}
  for (const f of m.fields) if (f.kind === 'object') RELATIONS[m.name][f.name] = f.type
}

function redactAll(v: unknown): unknown {
  let out = toJsonSafe(v)
  for (const model of Object.keys(REDACTED_FIELDS)) out = redact(model, { v: out }).v
  return out
}

/** Nested relation writes in `data` (e.g. `items: { create: [...] }`), as `{ field: { from: null, to: <redacted args> } }`. */
function nestedChanges(model: string, data: any): Record<string, { from: null; to: unknown }> {
  const out: Record<string, { from: null; to: unknown }> = {}
  const rel = RELATIONS[model] ?? {}
  if (!data || typeof data !== 'object') return out
  for (const [k, v] of Object.entries(data)) if (k in rel && v !== undefined) out[k] = { from: null, to: redactAll(v) }
  return out
}

type Entry = { model: string; recordId: string | null; action: string; changes: Record<string, unknown> | null; reason?: string | null }

export function auditRowData(actor: AuditActor, e: Entry) {
  return {
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    model: e.model,
    recordId: e.recordId,
    action: e.action,
    changes: e.changes == null ? Prisma.JsonNull : (toJsonSafe(e.changes) as Prisma.InputJsonValue),
    reason: e.reason ?? null,
  }
}

async function insertAudit(tx: any, e: Entry) {
  const data = auditRowData(getCurrentActor(), e)
  if (process.env.NODE_ENV !== 'production' && process.env.AUDIT_TEST_FAIL === '1') {
    // Test-only: force a real database error (duplicate primary key) inside the transaction.
    const id = `audit-test-fail-${Date.now()}-${Math.random()}`
    await tx.auditLog.create({ data: { ...data, id } })
    await tx.auditLog.create({ data: { ...data, id } })
    return
  }
  await tx.auditLog.create({ data })
}

/** Ensure `select` (when present) includes the given scalar keys; returns the keys we added so they can be stripped. */
function withSelected(args: any, keys: string[]) {
  if (!args?.select) return { args, added: [] as string[] }
  const added = keys.filter((k) => !args.select[k])
  if (!added.length) return { args, added }
  return { args: { ...args, select: { ...args.select, ...Object.fromEntries(added.map((k) => [k, true])) } }, added }
}
function strip<T>(result: T, added: string[]): T {
  if (!added.length || !result) return result
  const one = (r: any) => { for (const k of added) delete r[k]; return r }
  return (Array.isArray(result) ? result.map(one) : one(result)) as T
}
const needsReread = (args: any) => !!(args?.select || args?.include || args?.omit)
const idKeys = (model: string) => (model === 'JournalEntry' ? ['id', 'isManual'] : ['id'])
const idSelect = (model: string) => Object.fromEntries(idKeys(model).map((k) => [k, true]))

function bulkChanges(rows: any[], count: number) {
  const ids = rows.map((r) => r.id)
  return ids.length > BULK_ID_CAP ? { count, ids: ids.slice(0, BULK_ID_CAP), truncated: true } : { count, ids }
}

async function cascadeSnapshot(tx: any, model: string, id: string) {
  const snap: Record<string, unknown[]> = {}
  const truncated: Record<string, number> = {}
  const walk = async (parent: string, parentIds: string[]) => {
    for (const c of CASCADE_CHILDREN[parent] ?? []) {
      if (!parentIds.length) continue
      const rows = await tx[delegateKey(c.model)].findMany({ where: { [c.fk]: { in: parentIds } }, take: CASCADE_SNAPSHOT_CAP + 1 })
      if (!rows.length) continue
      if (rows.length > CASCADE_SNAPSHOT_CAP) {
        truncated[c.model] = await tx[delegateKey(c.model)].count({ where: { [c.fk]: { in: parentIds } } })
        rows.length = CASCADE_SNAPSHOT_CAP
      }
      snap[c.model] = ((snap[c.model] as unknown[]) ?? []).concat(rows.map((r: any) => redact(c.model, toJsonSafe(r) as Record<string, unknown>)))
      await walk(c.model, rows.map((r: any) => r.id))
    }
  }
  await walk(model, [id])
  if (!Object.keys(snap).length) return null
  return Object.keys(truncated).length ? { _cascaded: snap, _cascadedTotal: truncated } : { _cascaded: snap }
}

/** Runs one audited write on transaction client `tx` (the business write itself goes through `query`). */
async function auditedWrite(tx: any, model: string, operation: string, args: any, query: (a: any) => Promise<any>) {
  const d = tx[delegateKey(model)]
  switch (operation) {
    case 'create': {
      // Auto-posted ledger entries are skipped without any extra work.
      if (model === 'JournalEntry' && args?.data?.isManual !== true) return query(args)
      const { args: a, added } = withSelected(args, ['id'])
      const result = await query(a)
      const after = needsReread(args) ? await d.findUnique({ where: { id: result.id } }) : result
      if (shouldAuditRow(model, after)) {
        await insertAudit(tx, { model, recordId: after.id, action: 'CREATE', changes: { ...diffRecords(model, null, after), ...nestedChanges(model, args.data) } })
      }
      return strip(result, added)
    }
    case 'update':
    case 'upsert': {
      const before = await d.findUnique({ where: args.where })
      const { args: a, added } = withSelected(args, ['id'])
      const result = await query(a)
      const after = needsReread(args) ? await d.findUnique({ where: { id: result.id } }) : result
      if (shouldAuditRow(model, after) || (before && shouldAuditRow(model, before))) {
        const created = operation === 'upsert' && !before
        const data = operation === 'update' ? args.data : created ? args.create : args.update
        const diff = diffRecords(model, created ? null : before, after)
        const nested = nestedChanges(model, data)
        const meaningful = Object.keys(nested).length > 0 || (Object.keys(diff).length > 0 && !isNoiseOnly(model, diff))
        if (created || meaningful) {
          await insertAudit(tx, { model, recordId: after.id, action: created ? 'CREATE' : 'UPDATE', changes: { ...diff, ...nested } })
        }
      }
      return strip(result, added)
    }
    case 'delete': {
      const before = await d.findUnique({ where: args.where })
      const cascaded = before && shouldAuditRow(model, before) ? await cascadeSnapshot(tx, model, before.id) : null
      const result = await query(args)
      if (before && shouldAuditRow(model, before)) {
        await insertAudit(tx, { model, recordId: before.id, action: 'DELETE', changes: { ...diffRecords(model, before, null), ...(cascaded ?? {}) } })
      }
      return result
    }
    case 'createMany': {
      // Re-issued as createManyAndReturn (same rows) so the created ids are known; that call logs BULK_CREATE.
      const rows = await d.createManyAndReturn({ data: args.data, skipDuplicates: args.skipDuplicates, select: idSelect(model) })
      return { count: rows.length }
    }
    case 'updateMany': {
      const { select: _s, ...rest } = args ?? {}
      const rows = await d.updateManyAndReturn({ ...rest, select: idSelect(model) })
      return { count: rows.length }
    }
    case 'createManyAndReturn':
    case 'updateManyAndReturn': {
      const { args: a, added } = args?.select ? withSelected(args, idKeys(model)) : { args, added: [] as string[] }
      const rows: any[] = await query(a)
      const logged = rows.filter((r) => shouldAuditRow(model, r))
      if (logged.length) {
        await insertAudit(tx, { model, recordId: null, action: operation === 'createManyAndReturn' ? 'BULK_CREATE' : 'BULK_UPDATE', changes: bulkChanges(logged, logged.length) })
      }
      return strip(rows, added)
    }
    case 'deleteMany': {
      const rows: any[] = await d.findMany({ where: args?.where, select: idSelect(model), ...(args?.limit ? { take: args.limit } : {}) })
      const result = await query(args)
      const logged = rows.filter((r) => shouldAuditRow(model, r))
      if (result.count > 0 && logged.length) {
        await insertAudit(tx, { model, recordId: null, action: 'BULK_DELETE', changes: bulkChanges(logged, model === 'JournalEntry' ? logged.length : result.count) })
      }
      return result
    }
  }
  return query(args)
}

export const auditExtension = Prisma.defineExtension((client) => {
  const txClients = new Map<string, any>()

  const runInTx = (target: any, fn: (tx: any) => Promise<any>, opts?: any) =>
    target.$transaction(async (tx: any) => {
      const id = txIdOf(tx)
      const own = !!id && !txClients.has(id)
      if (own) txClients.set(id!, tx)
      try {
        return await fn(tx)
      } finally {
        if (own) txClients.delete(id!)
      }
    }, opts)

  const inner: any = client.$extends({
    name: 'audit',
    query: {
      $allModels: {
        async $allOperations(params: any) {
          const { model, operation, args, query } = params
          if (!WRITE_OPS.has(operation)) return query(args)
          if (model === 'AuditLog') {
            if (AUDIT_LOG_MUTATIONS.has(operation) && process.env.AUDIT_ALLOW_PURGE !== '1') {
              throw new Error('AuditLog is append-only: updates and deletes are refused')
            }
            return query(args)
          }
          if (!shouldAuditModel(model)) return query(args)

          const t = params.__internalParams?.transaction
          if (!t) {
            if (model === 'JournalEntry' && operation === 'create' && args?.data?.isManual !== true) return query(args)
            return runInTx(inner, (tx) => tx[delegateKey(model)][operation](args), WRAP_TX_OPTS)
          }
          if (t.kind !== 'itx') {
            throw new Error(`Audited write ${model}.${operation} cannot run inside an array $transaction; use an interactive transaction`)
          }
          const tx = txClients.get(t.id)
          if (!tx) throw new Error(`Audit: no transaction client registered for ${model}.${operation}`)
          return auditedWrite(tx, model, operation, args, query)
        },
      },
    },
  })

  return inner.$extends({
    name: 'audit-transactions',
    client: {
      $transaction(arg: any, opts?: any) {
        if (typeof arg !== 'function') return inner.$transaction(arg, opts)
        return runInTx(inner, arg, opts)
      },
    },
  })
})
