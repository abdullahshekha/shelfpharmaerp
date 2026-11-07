/* eslint-disable @typescript-eslint/no-explicit-any */
import { AsyncLocalStorage } from 'async_hooks'
import { Prisma } from '@prisma/client'
import { getCurrentActor, type AuditActor } from './actor'
import { CASCADE_CHILDREN, CASCADE_SNAPSHOT_CAP } from './cascade'
import { REDACTED_FIELDS, shouldAuditModel, shouldAuditRow } from './config'
import { diffRecords, isNoiseOnly, redact, toJsonSafe } from './diff'

/*
 * Audit extension — every create/update/upsert/delete (single and bulk) records AuditLog rows
 * IN THE SAME DATABASE TRANSACTION as the business write, so both commit or both roll back.
 *
 * Mechanism (proved by the Task 3 spike, Prisma 7 + adapter-pg):
 * - A write that is not already in an interactive transaction is re-issued inside one:
 *   `inner.$transaction(tx => tx[model][op](args))`. That re-enters this hook with a transaction.
 * - A write inside an interactive transaction carries `__internalParams.transaction = { kind: 'itx', id }`.
 *   The hook looks the transaction client up by that id in `txClients` and runs its before-reads on it,
 *   i.e. on the same connection/transaction (no second connection => no deadlock).
 * - `txClients` is filled by our own wrapper above and by the `$transaction` override on the exported
 *   client. Nested `tx.$transaction` reuses the outer transaction id (savepoint), so it resolves too.
 * - Audit rows are buffered per transaction and written with ONE `auditLog.createMany` after the transaction
 *   callback returns, still inside the transaction (a failure there rolls the whole transaction back). While a
 *   nested (savepoint) scope is open, rows are inserted immediately instead, so a savepoint rollback the caller
 *   catches also discards them.
 * - Array (batch) transactions cannot run extra queries, so audited writes in them are refused.
 * Reads and excluded models go straight to `query(args)` — no extra queries.
 *
 * Bulk writes (createMany / updateMany / deleteMany and the *AndReturn forms) that touch at most ROW_CAP rows are
 * logged per row exactly like single writes (old/new values, cascade snapshots), because the app uses single-row
 * `updateMany`/`deleteMany` "claims" in its core order flows. Above ROW_CAP one BULK_* entry is written with the
 * count, capped ids and a redacted summary of the data / where.
 */

const SCOPE = Symbol.for('prisma.client.transaction.scope_context')
const WRITE_OPS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany',
])
const AUDIT_LOG_MUTATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany'])
/** Bulk writes touching at most this many rows get per-row entries. */
export const ROW_CAP = 25
const BULK_ID_CAP = 500
const SUMMARY_DISTINCT_CAP = 50
// Plain (non-transactional) writes get wrapped in a transaction. Plain writes never had a time limit, and large
// bulk writes (offer-list assign: hundreds of thousands of rows) must not get one now, so the cap is generous;
// the serverless function's own limit bounds it in practice.
const WRAP_TX_OPTS = { maxWait: 10000, timeout: 300000 }

const delegateKey = (model: string) => model.charAt(0).toLowerCase() + model.slice(1)
const txIdOf = (tx: any): string | undefined => tx?.[SCOPE]?.txId
const scopeDepth = (tx: any): number => tx?.[SCOPE]?.scopeState?.stack?.length ?? 1

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
type Log = (e: Entry) => Promise<void>

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

async function writeRows(tx: any, rows: any[]) {
  if (!rows.length) return
  if (process.env.NODE_ENV !== 'production' && process.env.AUDIT_TEST_FAIL === '1') {
    // Test-only: force a real database error (duplicate primary key) inside the transaction.
    const id = `audit-test-fail-${Date.now()}-${Math.random()}`
    await tx.auditLog.createMany({ data: [{ ...rows[0], id }, { ...rows[0], id }] })
    return
  }
  await tx.auditLog.createMany({ data: rows })
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
const takeFor = (args: any, n: number) => (typeof args?.limit === 'number' ? Math.min(args.limit, n) : n)

function idList(rows: any[]) {
  const ids = rows.map((r) => r.id)
  return ids.length > BULK_ID_CAP ? { ids: ids.slice(0, BULK_ID_CAP), truncated: true } : { ids }
}

/** Small, redacted picture of a large createMany payload: a few sample rows and the distinct values of its *Id fields. */
function dataSummary(data: any[]) {
  const distinct: Record<string, Set<unknown>> = {}
  for (const row of data) {
    for (const [k, v] of Object.entries(row ?? {})) if (/Id$/.test(k) && v != null) (distinct[k] ??= new Set()).add(v)
  }
  const idFields: Record<string, { values: unknown[]; distinct: number }> = {}
  for (const [k, s] of Object.entries(distinct)) idFields[k] = { values: Array.from(s).slice(0, SUMMARY_DISTINCT_CAP), distinct: s.size }
  return { sample: redactAll(data.slice(0, 3)), idFields }
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

async function logUpdate(log: Log, model: string, before: any, after: any, nested: Record<string, unknown> = {}) {
  if (!after || !(shouldAuditRow(model, after) || (before && shouldAuditRow(model, before)))) return
  const diff = diffRecords(model, before, after)
  if (Object.keys(nested).length > 0 || (Object.keys(diff).length > 0 && !isNoiseOnly(model, diff))) {
    await log({ model, recordId: after.id, action: 'UPDATE', changes: { ...diff, ...nested } })
  }
}

/** Runs one audited write on transaction client `tx` (the business write itself goes through `query`). */
async function auditedWrite(tx: any, log: Log, model: string, operation: string, args: any, query: (a: any) => Promise<any>) {
  const d = tx[delegateKey(model)]
  switch (operation) {
    case 'create': {
      // Auto-posted ledger entries are skipped without any extra work.
      if (model === 'JournalEntry' && args?.data?.isManual !== true) return query(args)
      const { args: a, added } = withSelected(args, ['id'])
      const result = await query(a)
      const after = needsReread(args) ? await d.findUnique({ where: { id: result.id } }) : result
      if (shouldAuditRow(model, after)) {
        await log({ model, recordId: after.id, action: 'CREATE', changes: { ...diffRecords(model, null, after), ...nestedChanges(model, args.data) } })
      }
      return strip(result, added)
    }
    case 'update':
    case 'upsert': {
      const before = await d.findUnique({ where: args.where })
      const { args: a, added } = withSelected(args, ['id'])
      const result = await query(a)
      const after = needsReread(args) ? await d.findUnique({ where: { id: result.id } }) : result
      const created = operation === 'upsert' && !before
      const data = operation === 'update' ? args.data : created ? args.create : args.update
      if (created) {
        if (shouldAuditRow(model, after)) {
          await log({ model, recordId: after.id, action: 'CREATE', changes: { ...diffRecords(model, null, after), ...nestedChanges(model, data) } })
        }
      } else {
        await logUpdate(log, model, before, after, nestedChanges(model, data))
      }
      return strip(result, added)
    }
    case 'delete': {
      const before = await d.findUnique({ where: args.where })
      const cascaded = before && shouldAuditRow(model, before) ? await cascadeSnapshot(tx, model, before.id) : null
      const result = await query(args)
      if (before && shouldAuditRow(model, before)) {
        await log({ model, recordId: before.id, action: 'DELETE', changes: { ...diffRecords(model, before, null), ...(cascaded ?? {}) } })
      }
      return result
    }
    case 'createMany': {
      const rows: any[] = Array.isArray(args?.data) ? args.data : args?.data ? [args.data] : []
      if (model === 'JournalEntry' && rows.every((r) => r?.isManual !== true)) return query(args)
      if (rows.length <= ROW_CAP) {
        // Re-issued as createManyAndReturn (same rows) so the created rows are known; that call logs one CREATE per row.
        const created = await d.createManyAndReturn({ data: args.data, ...(args.skipDuplicates !== undefined ? { skipDuplicates: args.skipDuplicates } : {}) })
        return { count: created.length }
      }
      // Large: plain createMany (no rows returned) and one summary entry.
      const result = await query(args)
      if (result.count > 0) {
        await log({ model, recordId: null, action: 'BULK_CREATE', changes: { count: result.count, data: dataSummary(rows) } })
      }
      return result
    }
    case 'createManyAndReturn': {
      const { args: a, added } = withSelected(args, idKeys(model))
      const rows: any[] = await query(a)
      if (rows.length <= ROW_CAP) {
        const full: any[] = needsReread(args) && rows.length ? await d.findMany({ where: { id: { in: rows.map((r) => r.id) } } }) : rows
        for (const r of full) if (shouldAuditRow(model, r)) await log({ model, recordId: r.id, action: 'CREATE', changes: diffRecords(model, null, r) })
      } else {
        const logged = rows.filter((r) => shouldAuditRow(model, r))
        const data: any[] = Array.isArray(args?.data) ? args.data : [args?.data]
        if (logged.length) await log({ model, recordId: null, action: 'BULK_CREATE', changes: { count: logged.length, ...idList(logged), data: dataSummary(data) } })
      }
      return strip(rows, added)
    }
    case 'updateMany':
    case 'updateManyAndReturn': {
      const before: any[] = await d.findMany({ where: args?.where, take: takeFor(args, ROW_CAP + 1) })
      if (!before.length) return query(args)
      if (before.length <= ROW_CAP) {
        const { args: a, added } = operation === 'updateManyAndReturn' ? withSelected(args, ['id']) : { args, added: [] as string[] }
        const result = await query(a)
        const afterRows: any[] = operation === 'updateManyAndReturn' && !needsReread(args)
          ? result
          : await d.findMany({ where: { id: { in: before.map((r) => r.id) } } })
        const afterById = new Map(afterRows.map((r) => [r.id, r]))
        for (const b of before) await logUpdate(log, model, b, afterById.get(b.id))
        return strip(result, added)
      }
      const ids: any[] = await d.findMany({ where: args?.where, select: idSelect(model), take: takeFor(args, BULK_ID_CAP + 1) })
      const result = await query(args)
      const count = Array.isArray(result) ? result.length : result.count
      const logged = ids.filter((r) => shouldAuditRow(model, r))
      if (count > 0 && logged.length) {
        await log({ model, recordId: null, action: 'BULK_UPDATE', changes: { count, ...idList(logged), where: redactAll(args?.where ?? null), data: redactAll(args?.data ?? null) } })
      }
      return result
    }
    case 'deleteMany': {
      const before: any[] = await d.findMany({ where: args?.where, take: takeFor(args, ROW_CAP + 1) })
      if (!before.length) return query(args)
      if (before.length <= ROW_CAP) {
        const audited = before.filter((r) => shouldAuditRow(model, r))
        const snaps = new Map<string, unknown>()
        for (const r of audited) snaps.set(r.id, await cascadeSnapshot(tx, model, r.id))
        const result = await query(args)
        if (result.count > 0) {
          for (const r of audited) {
            await log({ model, recordId: r.id, action: 'DELETE', changes: { ...diffRecords(model, r, null), ...((snaps.get(r.id) as object) ?? {}) } })
          }
        }
        return result
      }
      const ids: any[] = await d.findMany({ where: args?.where, select: idSelect(model), take: takeFor(args, BULK_ID_CAP + 1) })
      const result = await query(args)
      const logged = ids.filter((r) => shouldAuditRow(model, r))
      if (result.count > 0 && logged.length) {
        const count = model === 'JournalEntry' ? logged.length : result.count
        await log({ model, recordId: null, action: 'BULK_DELETE', changes: { count, ...idList(logged), where: redactAll(args?.where ?? null) } })
      }
      return result
    }
  }
  return query(args)
}

export const auditExtension = Prisma.defineExtension((client) => {
  const txClients = new Map<string, any>()
  /** Audit rows waiting to be flushed, per transaction id (only for transactions this extension opened/registered). */
  const buffers = new Map<string, any[]>()
  /** Set while our wrapper re-issues a plain write inside its transaction (re-entrancy guard). */
  const reissuing = new AsyncLocalStorage<true>()

  const runInTx = (target: any, fn: (tx: any) => Promise<any>, opts?: any) =>
    target.$transaction(async (tx: any) => {
      const id = txIdOf(tx)
      const own = !!id && !txClients.has(id)
      if (own) {
        txClients.set(id!, tx)
        buffers.set(id!, [])
      }
      try {
        const result = await fn(tx)
        // Still inside the transaction: if this insert fails, the business writes roll back with it.
        if (own) await writeRows(tx, buffers.get(id!) ?? [])
        return result
      } finally {
        if (own) {
          txClients.delete(id!)
          buffers.delete(id!)
        }
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
            const purgeAllowed = process.env.NODE_ENV !== 'production' && process.env.AUDIT_ALLOW_PURGE === '1'
            if (AUDIT_LOG_MUTATIONS.has(operation) && !purgeAllowed) {
              throw new Error('AuditLog is append-only: updates and deletes are refused')
            }
            return query(args)
          }
          if (!shouldAuditModel(model)) return query(args)

          const t = params.__internalParams?.transaction
          if (!t) {
            if (reissuing.getStore()) {
              // Our own re-issued write arrived without a transaction: Prisma internals changed. Refuse instead of
              // opening another transaction (which would recurse until the pool is exhausted).
              throw new Error(`Audit: ${model}.${operation} lost its transaction context (Prisma internals changed?); refusing to write unaudited`)
            }
            if (model === 'JournalEntry' && operation === 'create' && args?.data?.isManual !== true) return query(args)
            return runInTx(inner, (tx) => reissuing.run(true, () => tx[delegateKey(model)][operation](args)), WRAP_TX_OPTS)
          }
          if (t.kind !== 'itx') {
            throw new Error(`Audited write ${model}.${operation} cannot run inside an array $transaction; use an interactive transaction`)
          }
          const tx = txClients.get(t.id)
          if (!tx) throw new Error(`Audit: no transaction client registered for ${model}.${operation}`)
          const log: Log = async (e) => {
            const row = { ...auditRowData(getCurrentActor(), e), createdAt: new Date() }
            const buf = buffers.get(t.id)
            // Inside a nested (savepoint) scope insert right away so a caught savepoint rollback discards the row too.
            if (buf && scopeDepth(tx) <= 1) buf.push(row)
            else await writeRows(tx, [row])
          }
          return auditedWrite(tx, log, model, operation, args, query)
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
