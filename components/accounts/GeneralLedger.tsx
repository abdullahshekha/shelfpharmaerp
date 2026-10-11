'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { downloadCsv } from '@/lib/utils/csv'
import { Download, Plus, Undo2 } from 'lucide-react'
import { AccountSelect } from './AccountSelect'
import { ManualJournalDialog } from './ManualJournalDialog'
import { SOURCE_LABELS, sourceHref, karachiDay, todayKarachi, type Account } from './types'

interface LedgerRow {
  lineId: string; entryId: string; entryNumber: string; date: string; memo: string | null; lineMemo: string | null
  sourceType: string | null; sourceId: string | null; isManual: boolean
  debit: number; credit: number; balance: number
}
interface Ledger {
  account: { id: string; code: string; name: string; type: string; normal: 'DEBIT' | 'CREDIT' }
  opening: number; totalDebit: number; totalCredit: number; closing: number; rows: LedgerRow[]
}

export function GeneralLedger() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [range, setRange] = useState<DateRange | null>(null)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [loading, setLoading] = useState(false)
  const [journalOpen, setJournalOpen] = useState(false)
  const [reversing, setReversing] = useState<string | null>(null)

  useEffect(() => {
    // includeInactive so accounts deactivated after posting remain viewable.
    fetch('/api/accounts/accounts?includeInactive=1')
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
        return j
      })
      .then(j => {
        const list: Account[] = j.data ?? []
        setAccounts(list)
        const first = list.find(a => a.isActive) ?? list[0]
        if (first) setAccountId(prev => prev || first.id)
      })
      .catch(e => toast.error(`Could not load accounts: ${e.message}`))
  }, [])

  const reqId = useRef(0)
  const load = useCallback(async () => {
    if (!accountId) return
    const id = ++reqId.current
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (range?.from) p.set('from', range.from)
      if (range?.to) p.set('to', range.to)
      const res = await fetch(`/api/accounts/ledger/${accountId}?${p}`)
      const j = await res.json().catch(() => ({}))
      if (id !== reqId.current) return // a newer request superseded this one
      if (!res.ok) { toast.error(j.error ?? 'Could not load ledger'); setLedger(null); return }
      setLedger(j.data)
    } catch {
      if (id !== reqId.current) return
      toast.error('Network error loading ledger')
      setLedger(null)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [accountId, range])
  useEffect(() => { load() }, [load])

  // Entry numbers whose reversal is visible in the loaded rows (a reversal's memo starts "Reversal of <number>").
  const reversed = useMemo(() => {
    const set = new Set<string>()
    for (const r of ledger?.rows ?? []) {
      const m = /^Reversal of (\S+)/.exec(r.memo ?? '')
      if (m) set.add(m[1])
    }
    return set
  }, [ledger])

  const reverse = async (r: LedgerRow) => {
    if (!confirm(`Reverse ${r.entryNumber}? A mirrored entry dated today will be posted.`)) return
    setReversing(r.entryId)
    try {
      const res = await fetch(`/api/accounts/journals/${r.entryId}/reverse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not reverse entry')
      toast.success(`Posted ${j.data?.entryNumber ?? 'reversal'}`)
      load()
    } catch {
      toast.error('Network error while reversing')
    } finally {
      setReversing(null)
    }
  }

  const exportCsv = () => {
    if (!ledger) return
    downloadCsv(
      `ledger-${ledger.account.code}-${todayKarachi()}.csv`,
      ['Date', 'Entry', 'Source', 'Memo', 'Debit', 'Credit', 'Balance'],
      [
        ['', '', '', 'Opening balance', '', '', ledger.opening],
        ...ledger.rows.map(r => [
          karachiDay(r.date), r.entryNumber, r.isManual ? 'Manual' : (SOURCE_LABELS[r.sourceType ?? ''] ?? r.sourceType ?? ''),
          [r.memo, r.lineMemo].filter(Boolean).join(' / '), r.debit, r.credit, r.balance,
        ]),
        ['', '', '', 'Closing balance', ledger.totalDebit, ledger.totalCredit, ledger.closing],
      ],
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">General Ledgers</h1>
          <p className="text-slate-500 text-sm">Account-wise postings with running balance</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={!ledger}><Download size={14} /> Export CSV</Button>
          <Button size="sm" className="gap-2" onClick={() => setJournalOpen(true)} disabled={!accounts.length}><Plus size={14} /> Manual entry</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} className="w-72 h-8 text-sm" />
        <DateRangePicker value={range} onChange={setRange} />
        {range && <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500" onClick={() => setRange(null)}>All dates</Button>}
      </div>

      {ledger && (
        <p className="text-sm text-slate-600">
          {ledger.account.code} · {ledger.account.name} <Badge variant="secondary">{ledger.account.type}, {ledger.account.normal.toLowerCase()}-normal</Badge>
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-3 py-3 font-medium">Entry</th>
                  <th className="text-left px-3 py-3 font-medium">Source / memo</th>
                  <th className="text-right px-3 py-3 font-medium">Debit</th>
                  <th className="text-right px-3 py-3 font-medium">Credit</th>
                  <th className="text-right px-4 py-3 font-medium">Balance</th>
                  <th className="px-2 py-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b animate-pulse"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td></tr>
                  ))
                ) : !ledger ? (
                  <tr><td colSpan={7} className="text-center py-12 text-slate-400">Select an account.</td></tr>
                ) : (
                  <>
                    <tr className="border-b bg-slate-50/60">
                      <td colSpan={5} className="px-4 py-2 text-slate-500">Opening balance</td>
                      <td className="px-4 py-2 text-right font-medium">{formatPKR(ledger.opening)}</td>
                      <td />
                    </tr>
                    {ledger.rows.length === 0 && (
                      <tr><td colSpan={7} className="text-center py-8 text-slate-400">No postings in this range.</td></tr>
                    )}
                    {ledger.rows.map(r => {
                      const href = sourceHref(r.sourceType, r.sourceId)
                      const label = r.isManual ? 'Manual' : (SOURCE_LABELS[r.sourceType ?? ''] ?? r.sourceType ?? '')
                      const isReversal = /^Reversal of /.test(r.memo ?? '')
                      const canReverse = r.isManual && !isReversal && !reversed.has(r.entryNumber)
                      return (
                        <tr key={r.lineId} className="border-b">
                          <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.entryNumber}</td>
                          <td className="px-3 py-2">
                            {href ? <Link href={href} className="text-blue-600 hover:underline">{label}</Link> : <span>{label}</span>}
                            {(r.memo || r.lineMemo) && <span className="text-slate-500"> — {[r.memo, r.lineMemo].filter(Boolean).join(' / ')}</span>}
                          </td>
                          <td className="px-3 py-2 text-right">{r.debit ? formatPKR(r.debit) : ''}</td>
                          <td className="px-3 py-2 text-right">{r.credit ? formatPKR(r.credit) : ''}</td>
                          <td className="px-4 py-2 text-right font-medium">{formatPKR(r.balance)}</td>
                          <td className="px-2 py-2">
                            {canReverse && (
                              <Button variant="ghost" size="icon-sm" title="Reverse entry" aria-label={`Reverse ${r.entryNumber}`} disabled={reversing === r.entryId} onClick={() => reverse(r)}>
                                <Undo2 size={14} />
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-slate-50 font-medium">
                      <td colSpan={3} className="px-4 py-2">Totals / closing balance</td>
                      <td className="px-3 py-2 text-right">{formatPKR(ledger.totalDebit)}</td>
                      <td className="px-3 py-2 text-right">{formatPKR(ledger.totalCredit)}</td>
                      <td className="px-4 py-2 text-right">{formatPKR(ledger.closing)}</td>
                      <td />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ManualJournalDialog open={journalOpen} onOpenChange={setJournalOpen} accounts={accounts} onPosted={load} />
    </div>
  )
}
