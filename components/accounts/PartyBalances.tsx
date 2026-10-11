'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { downloadCsv } from '@/lib/utils/csv'
import { Download, FileText, Plus } from 'lucide-react'
import { PartyPicker, type Party } from './PartyPicker'
import { SOURCE_LABELS, sourceHref, karachiDay, todayKarachi } from './types'

type Mode = 'receivable' | 'payable'

interface PartyRow { id: string; name: string; ledger: number; invoice: number; difference: number }
interface ListMeta {
  total: number; limit: number; offset: number
  totals: { ledger: number; invoice: number; difference: number; differingParties: number }
  goLiveDate: string | null; lockedThrough: string | null
}
interface StatementRow {
  lineId: string; entryNumber: string; date: string; memo: string | null; lineMemo: string | null
  sourceType: string | null; sourceId: string | null; isManual: boolean; debit: number; credit: number; balance: number
}
interface Statement {
  party: { id: string; name: string }; normal: 'DEBIT' | 'CREDIT'
  opening: number; totalDebit: number; totalCredit: number; closing: number
  ledgerBalance: number; invoiceBalance: number; difference: number; rows: StatementRow[]
}

const COPY = {
  receivable: { title: 'Accounts Receivable', sub: 'Customer balances from the ledger, reconciled against invoices', party: 'Customer', parties: 'customers', kind: 'customer' as const, invoiceCol: 'Per invoices' },
  payable: { title: 'Accounts Payable', sub: 'Supplier balances from the ledger, reconciled against purchase invoices', party: 'Supplier', parties: 'suppliers', kind: 'supplier' as const, invoiceCol: 'Per purchase invoices' },
}
const PAGE = 50
const isZero = (n: number) => Math.round(n * 100) === 0

export function PartyBalances({ mode }: { mode: Mode }) {
  const c = COPY[mode]
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [nonZero, setNonZero] = useState(true)
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<PartyRow[]>([])
  const [meta, setMeta] = useState<ListMeta | null>(null)
  const [loading, setLoading] = useState(true)

  const [stmtParty, setStmtParty] = useState<PartyRow | null>(null)
  const [openingOpen, setOpeningOpen] = useState(false)
  const [openingParty, setOpeningParty] = useState<Party | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setOffset(0) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const reqId = useRef(0)
  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
      if (debounced) p.set('search', debounced)
      if (nonZero) p.set('nonZero', '1')
      if (onlyDiff) p.set('diff', '1')
      const res = await fetch(`/api/accounts/${mode}?${p}`)
      const j = await res.json().catch(() => ({}))
      if (id !== reqId.current) return
      if (!res.ok) { toast.error(j.error ?? `Could not load ${c.parties}`); setRows([]); setMeta(null); return }
      setRows(j.data ?? [])
      setMeta(j.meta)
    } catch {
      if (id !== reqId.current) return
      toast.error(`Network error loading ${c.parties}`)
      setRows([]); setMeta(null)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [mode, debounced, nonZero, onlyDiff, offset, c.parties])
  useEffect(() => { load() }, [load])

  const exportCsv = async () => {
    try {
      const out: (string | number)[][] = []
      for (let o = 0; ; o += 200) {
        const p = new URLSearchParams({ limit: '200', offset: String(o) })
        if (debounced) p.set('search', debounced)
        if (nonZero) p.set('nonZero', '1')
        if (onlyDiff) p.set('diff', '1')
        const res = await fetch(`/api/accounts/${mode}?${p}`)
        const j = await res.json().catch(() => ({}))
        if (!res.ok) return toast.error(j.error ?? 'Could not export')
        for (const r of j.data as PartyRow[]) out.push([r.name, r.ledger, r.invoice, r.difference])
        if (o + 200 >= j.meta.total) break
      }
      downloadCsv(`${mode}-${todayKarachi()}.csv`, [c.party, 'Ledger balance', c.invoiceCol, 'Difference'], out)
    } catch {
      toast.error('Network error while exporting')
    }
  }

  const to = meta ? Math.min(offset + rows.length, meta.total) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">{c.title}</h1>
          <p className="text-slate-500 text-sm">{c.sub}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={!meta || meta.total === 0}><Download size={14} /> Export CSV</Button>
          <Button size="sm" className="gap-2" onClick={() => { setOpeningParty(null); setOpeningOpen(true) }}><Plus size={14} /> Opening balance</Button>
        </div>
      </div>

      {meta && (
        <div className="grid sm:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Ledger total</p><p className="text-lg font-semibold">{formatPKR(meta.totals.ledger)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">{c.invoiceCol}</p><p className="text-lg font-semibold">{formatPKR(meta.totals.invoice)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Difference</p><p className={`text-lg font-semibold ${isZero(meta.totals.difference) ? '' : 'text-amber-600'}`}>{formatPKR(meta.totals.difference)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">{c.party}s that differ</p><p className="text-lg font-semibold">{meta.totals.differingParties}</p></CardContent></Card>
        </div>
      )}
      {meta && !meta.goLiveDate && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          No go-live date is set, so the ledger is empty and opening balances cannot be posted yet. Set it in Accounts settings.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-8 w-64 text-sm" placeholder={`Search ${c.parties}…`} value={search} onChange={e => setSearch(e.target.value)} />
        <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={nonZero} onChange={e => { setNonZero(e.target.checked); setOffset(0) }} /> Non-zero only</label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={onlyDiff} onChange={e => { setOnlyDiff(e.target.checked); setOffset(0) }} /> Differences only</label>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">{c.party}</th>
                  <th className="text-right px-3 py-3 font-medium">Ledger balance</th>
                  <th className="text-right px-3 py-3 font-medium">{c.invoiceCol}</th>
                  <th className="text-right px-3 py-3 font-medium">Difference</th>
                  <th className="px-3 py-3 w-40" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b animate-pulse"><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td></tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12 text-slate-400">No {c.parties} match.</td></tr>
                ) : rows.map(r => (
                  <tr key={r.id} className="border-b">
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatPKR(r.ledger)}</td>
                    <td className="px-3 py-2 text-right">{formatPKR(r.invoice)}</td>
                    <td className="px-3 py-2 text-right">
                      {isZero(r.difference) ? <span className="text-slate-400">—</span> : <Badge variant="secondary" className="bg-amber-100 text-amber-800">{formatPKR(r.difference)}</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" className="gap-1 h-7" onClick={() => setStmtParty(r)}><FileText size={13} /> Statement</Button>
                      <Button variant="ghost" size="sm" className="h-7" onClick={() => { setOpeningParty({ id: r.id, name: r.name }); setOpeningOpen(true) }}>Opening</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {meta && meta.total > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{offset + 1}–{to} of {meta.total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={offset + PAGE >= meta.total || loading} onClick={() => setOffset(offset + PAGE)}>Next</Button>
          </div>
        </div>
      )}

      <StatementDialog mode={mode} party={stmtParty} onClose={() => setStmtParty(null)} />
      <OpeningDialog
        mode={mode} open={openingOpen} onOpenChange={setOpeningOpen} party={openingParty} setParty={setOpeningParty}
        goLiveDate={meta?.goLiveDate ?? null} onPosted={load}
      />
    </div>
  )
}

function StatementDialog({ mode, party, onClose }: { mode: Mode; party: PartyRow | null; onClose: () => void }) {
  const c = COPY[mode]
  const [range, setRange] = useState<DateRange | null>(null)
  const [stmt, setStmt] = useState<Statement | null>(null)
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  useEffect(() => { setRange(null); setStmt(null) }, [party?.id])

  useEffect(() => {
    if (!party) return
    const id = ++reqId.current
    setLoading(true)
    ;(async () => {
      try {
        const p = new URLSearchParams()
        if (range?.from) p.set('from', range.from)
        if (range?.to) p.set('to', range.to)
        const res = await fetch(`/api/accounts/${mode}/${party.id}?${p}`)
        const j = await res.json().catch(() => ({}))
        if (id !== reqId.current) return
        if (!res.ok) { toast.error(j.error ?? 'Could not load statement'); setStmt(null); return }
        setStmt(j.data)
      } catch {
        if (id !== reqId.current) return
        toast.error('Network error loading statement')
        setStmt(null)
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    })()
  }, [party, range, mode])

  const exportCsv = () => {
    if (!stmt) return
    downloadCsv(`statement-${stmt.party.name.replace(/\s+/g, '-')}-${todayKarachi()}.csv`,
      ['Date', 'Entry', 'Source', 'Memo', 'Debit', 'Credit', 'Balance'],
      [
        ['', '', '', 'Opening balance', '', '', stmt.opening],
        ...stmt.rows.map(r => [karachiDay(r.date), r.entryNumber, r.isManual ? 'Manual' : (SOURCE_LABELS[r.sourceType ?? ''] ?? r.sourceType ?? ''), [r.memo, r.lineMemo].filter(Boolean).join(' / '), r.debit, r.credit, r.balance]),
        ['', '', '', 'Closing balance', stmt.totalDebit, stmt.totalCredit, stmt.closing],
      ])
  }

  return (
    <Dialog open={!!party} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{party?.name} — statement</DialogTitle>
          <DialogDescription>{c.party} ledger with running balance ({mode === 'receivable' ? 'debit' : 'credit'}-normal).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          {range && <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500" onClick={() => setRange(null)}>All dates</Button>}
          <Button variant="outline" size="sm" className="gap-2 ml-auto" onClick={exportCsv} disabled={!stmt}><Download size={14} /> CSV</Button>
        </div>
        {stmt && (
          <p className="text-sm text-slate-600">
            Ledger {formatPKR(stmt.ledgerBalance)} · {c.invoiceCol.toLowerCase()} {formatPKR(stmt.invoiceBalance)}
            {!isZero(stmt.difference) && <Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800">Difference {formatPKR(stmt.difference)}</Badge>}
          </p>
        )}
        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600">
                <th className="text-left px-3 py-2 font-medium">Date</th>
                <th className="text-left px-3 py-2 font-medium">Entry</th>
                <th className="text-left px-3 py-2 font-medium">Source / memo</th>
                <th className="text-right px-3 py-2 font-medium">Debit</th>
                <th className="text-right px-3 py-2 font-medium">Credit</th>
                <th className="text-right px-3 py-2 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading…</td></tr>
              ) : !stmt ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">No data.</td></tr>
              ) : (
                <>
                  <tr className="border-b bg-slate-50/60"><td colSpan={5} className="px-3 py-2 text-slate-500">Opening balance</td><td className="px-3 py-2 text-right font-medium">{formatPKR(stmt.opening)}</td></tr>
                  {stmt.rows.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-slate-400">No postings in this range.</td></tr>}
                  {stmt.rows.map(r => {
                    const href = sourceHref(r.sourceType, r.sourceId)
                    const label = r.isManual ? 'Manual' : (SOURCE_LABELS[r.sourceType ?? ''] ?? r.sourceType ?? '')
                    return (
                      <tr key={r.lineId} className="border-b">
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.entryNumber}</td>
                        <td className="px-3 py-2">
                          {href ? <Link href={href} className="text-blue-600 hover:underline">{label}</Link> : <span>{label}</span>}
                          {(r.memo || r.lineMemo) && <span className="text-slate-500"> — {[r.memo, r.lineMemo].filter(Boolean).join(' / ')}</span>}
                        </td>
                        <td className="px-3 py-2 text-right">{r.debit ? formatPKR(r.debit) : ''}</td>
                        <td className="px-3 py-2 text-right">{r.credit ? formatPKR(r.credit) : ''}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatPKR(r.balance)}</td>
                      </tr>
                    )
                  })}
                  <tr className="bg-slate-50 font-medium">
                    <td colSpan={3} className="px-3 py-2">Totals / closing balance</td>
                    <td className="px-3 py-2 text-right">{formatPKR(stmt.totalDebit)}</td>
                    <td className="px-3 py-2 text-right">{formatPKR(stmt.totalCredit)}</td>
                    <td className="px-3 py-2 text-right">{formatPKR(stmt.closing)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function OpeningDialog({ mode, open, onOpenChange, party, setParty, goLiveDate, onPosted }: {
  mode: Mode; open: boolean; onOpenChange: (o: boolean) => void
  party: Party | null; setParty: (p: Party | null) => void; goLiveDate: string | null; onPosted: () => void
}) {
  const c = COPY[mode]
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setAmount('') }, [open])

  const submit = async () => {
    if (!party) return toast.error(`Choose a ${c.kind}`)
    const n = parseFloat(amount)
    if (!(n > 0)) return toast.error('Amount must be greater than zero')
    setSaving(true)
    try {
      const res = await fetch(`/api/accounts/${mode}/opening-balance`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partyId: party.id, amount: n }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not post opening balance')
      toast.success(`Posted ${j.data?.entryNumber ?? 'opening balance'}`)
      onOpenChange(false)
      onPosted()
    } catch {
      toast.error('Network error while posting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add opening balance</DialogTitle>
          <DialogDescription>
            {mode === 'receivable' ? 'Debits Accounts Receivable for the customer, credits Opening Balance Equity' : 'Debits Opening Balance Equity, credits Accounts Payable for the supplier'}
            {goLiveDate ? `, dated the go-live date (${karachiDay(goLiveDate)}).` : '. Set a go-live date in Accounts settings first.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-slate-500 mb-1">{c.party}</p>
            <PartyPicker kind={c.kind} value={party} onChange={setParty} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Amount (Rs.)</p>
            <Input type="number" min={0} step="0.01" className="h-8 w-48 text-sm text-right" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !goLiveDate}>{saving ? 'Posting…' : 'Post'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
