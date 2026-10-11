import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postEntry, getSettings } from '../../lib/accounting/core'
import { ensureChart } from '../../lib/accounting/accounts'

function fakeTx(maxRows: number | null) {
  const calls: string[] = []
  const created: any[] = []
  const tx: any = {
    $executeRaw: async (s: TemplateStringsArray) => { calls.push(s.join('?')); return 1 },
    $queryRaw: async () => [{ max: maxRows }],
    journalEntry: { create: async (a: any) => { created.push(a.data); return { ...a.data, lines: [] } } },
    accountingSettings: {
      findFirst: async () => null,
      upsert: async (a: any) => ({ id: a.create.id, defaultBankAccountId: null, lockedThrough: null }),
    },
    account: {},
  }
  return { tx, calls, created }
}

test('postEntry takes the advisory lock before allocating, numbers past 9999', async () => {
  const { tx, calls, created } = fakeTx(9999)
  await postEntry(tx, {
    date: new Date('2026-10-11T08:00:00Z'), isManual: true,
    lines: [{ accountId: 'a', debit: 5 }, { accountId: 'b', credit: 5 }],
  })
  assert.match(calls[0], /pg_advisory_xact_lock/)
  assert.equal(created[0].entryNumber, 'SP-JV-20261011-10000')
})

test('getSettings creates the fixed-id singleton when none exists', async () => {
  const { tx } = fakeTx(null)
  assert.equal((await getSettings(tx)).id, 'singleton')
})

test('ensureChart names a conflicting code', async () => {
  const db: any = { account: { findUnique: async () => ({ systemKey: null }), upsert: async () => ({ id: 'x' }), count: async () => 0 } }
  await assert.rejects(() => ensureChart(db), /1000/)
})
