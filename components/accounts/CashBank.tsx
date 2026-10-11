'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { downloadCsv } from '@/lib/utils/csv'
import { ArrowLeftRight, Banknote, Download, HandCoins, Landmark, Plus, Receipt } from 'lucide-react'
import { AccountSelect } from './AccountSelect'
import { karachiDay, todayKarachi, type Account } from './types'

type CBAccount = Account & { balance: number; isDefaultBank: boolean }
interface Meta { total: number; goLiveDate: string | null; lockedThrough: string | null }
interface Entry {
  id: string; entryNumber: string; date: string; memo: string | null; sourceType: string | null; isManual: boolean
  lines: { accountId: string; debit: string | number; credit: string | number; account: { code: string; name: string } }[]
}
type Kind = 'transfer' | 'expense' | 'receipt'

const newRequestId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const TITLES: Record<Kind, { title: string; desc: string; a: string; b: string }> = {
  transfer: { title: 'Transfer between accounts', desc: 'Moves money from one cash/bank account to another.', a: 'From (cash/bank)', b: 'To (cash/bank)' },
  expense: { title: 'Record expense / payment', desc: 'Money paid out of a cash/bank account to an expense (or other) account.', a: 'Paid from (cash/bank)', b: 'Expense account' },
  receipt: { title: 'Record other receipt', desc: 'Money received into a cash/bank account from an income (or other) account.', a: 'Received into (cash/bank)', b: 'Source account' },
}

function EntryDialog({ kind, open, onOpenChange, cashBank, others, onPosted }: {
  kind: Kind; open: boolean; onOpenChange: (o: boolean) => void
  cashBank: CBAccount[]; others: Account[]; onPosted: () => void
}) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayKarachi())
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const requestId = useRef('')

  useEffect(() => {
    if (open) { setA(''); setB(''); setAmount(''); setDate(todayKarachi()); setMemo(''); requestId.current = newRequestId() }
  }, [open])

  const t = TITLES[kind]
  const bOptions = kind === 'transfer' ? cashBank.filter(x => x.id !== a) : others
  const aOptions = kind === 'transfer' ? cashBank : cashBank

  const submit = async () => {
    if (submitting.current) return
    const amt = parseFloat(amount)
    if (!a) return toast.error(`Choose ${t.a.toLowerCase()}`)
    if (!b) return toast.error(`Choose ${t.b.toLowerCase()}`)
    if (a === b) return toast.error('Accounts must be different')
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('Enter an amount greater than zero')
    if (amt > 1e9) return toast.error('Amount is too large')
    submitting.current = true
    setSaving(true)
    try {
      const body =
        kind === 'transfer' ? { fromAccountId: a, toAccountId: b }
        : kind === 'expense' ? { fromAccountId: a, expenseAccountId: b }
        : { toAccountId: a, sourceAccountId: b }
      const res = await fetch(`/api/accounts/cash-bank/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, amount: Math.round(amt * 100) / 100, date, memo, requestId: requestId.current }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not post entry')
      toast.success(`Posted ${j.data?.entryNumber ?? 'entry'}`)
      onOpenChange(false)
      onPosted()
    } catch {
      toast.error('Network error — check the ledger before retrying')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-slate-500 mb-1">{t.a}</p>
            <AccountSelect accounts={aOptions} value={a} onChange={id => { setA(id); if (id === b) setB('') }} className="w-full h-8 text-sm" />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">{t.b}</p>
            <AccountSelect accounts={bOptions} value={b} onChange={setB} className="w-full h-8 text-sm" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-xs text-slate-500 mb-1">Amount (Rs.)</p>
              <Input type="number" min={0} step="0.01" className="h-8 text-sm text-right" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Date</p>
              <Input type="date" className="h-8 w-40 text-sm" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Memo</p>
            <Input className="h-8 text-sm" value={memo} onChange={e => setMemo(e.target.value)} placeholder="Description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Posting…' : 'Post'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CashBank() {
  const [accounts, setAccounts] = useState<CBAccount[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [others, setOthers] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<Kind | null>(null)
  const [bankOpen, setBankOpen] = useState(false)
  const [bankName, setBankName] = useState('')
  const [bankSaving, setBankSaving] = useState(false)
  const bankSubmitting = useRef(false)
  const [filter, setFilter] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)

  const reqId = useRef(0)
  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([fetch('/api/accounts/cash-bank'), fetch('/api/accounts/accounts')])
      const j1 = await r1.json().catch(() => ({}))
      const j2 = await r2.json().catch(() => ({}))
      if (id !== reqId.current) return
      if (!r1.ok) { toast.error(j1.error ?? 'Could not load cash & bank accounts'); return }
      setAccounts(j1.data ?? [])
      setMeta(j1.meta ?? null)
      if (r2.ok) {
        setOthers((j2.data as Account[]).filter(x => x.subType !== 'CASH' && x.subType !== 'BANK' && x.systemKey !== 'AR' && x.systemKey !== 'AP'))
      } else toast.error(j2.error ?? 'Could not load accounts')
    } catch {
      if (id === reqId.current) toast.error('Network error loading cash & bank')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const entReq = useRef(0)
  const loadEntries = useCallback(async () => {
    if (!accounts.length) { setEntries([]); return }
    const id = ++entReq.current
    setEntriesLoading(true)
    try {
      const targets = filter ? [filter] : accounts.map(a => a.id)
      const results = await Promise.all(targets.map(async acc => {
        const res = await fetch(`/api/accounts/journals?accountId=${acc}&pageSize=30`)
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
        return (j.data ?? []) as Entry[]
      }))
      if (id !== entReq.current) return
      const map = new Map<string, Entry>()
      results.flat().forEach(e => map.set(e.id, e))
      const list = Array.from(map.values()).sort((x, y) => (y.date.localeCompare(x.date)) || y.entryNumber.localeCompare(x.entryNumber)).slice(0, 30)
      setEntries(list)
    } catch (e) {
      if (id === entReq.current) { toast.error(`Could not load recent entries: ${(e as Error).message}`); setEntries([]) }
    } finally {
      if (id === entReq.current) setEntriesLoading(false)
    }
  }, [accounts, filter])
  useEffect(() => { loadEntries() }, [loadEntries])

  const cbIds = new Set(accounts.map(a => a.id))
  const effect = (e: Entry) => {
    const lines = e.lines.filter(l => cbIds.has(l.accountId) && (!filter || l.accountId === filter))
    return lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100), 0) / 100
  }
  const accountsLabel = (e: Entry) => e.lines.map(l => `${l.account.code} ${l.account.name}`).filter((v, i, a) => a.indexOf(v) === i).join(' ↔ ')

  const addBank = async () => {
    if (bankSubmitting.current) return
    const name = bankName.trim()
    if (!name) return toast.error('Enter a bank account name')
    bankSubmitting.current = true
    setBankSaving(true)
    try {
      const res = await fetch('/api/accounts/cash-bank/bank-accounts', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not add bank account')
      toast.success(`Added ${j.data?.code} · ${j.data?.name}`)
      setBankOpen(false)
      load()
    } catch {
      toast.error('Network error adding bank account')
    } finally {
      bankSubmitting.current = false
      setBankSaving(false)
    }
  }

  const exportCsv = () => downloadCsv(
    `cash-bank-${todayKarachi()}.csv`,
    ['Section', 'Date', 'Entry', 'Account(s)', 'Memo', 'Amount'],
    [
      ...accounts.map(a => ['Balance', todayKarachi(), '', `${a.code} ${a.name}`, '', a.balance]),
      ['Balance', todayKarachi(), '', 'Total cash + bank', '', meta?.total ?? ''],
      ...entries.map(e => ['Entry', karachiDay(e.date), e.entryNumber, accountsLabel(e), e.memo ?? '', effect(e)]),
    ],
  )

  const noGoLive = meta && !meta.goLiveDate

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Cash & Bank</h1>
          <p className="text-slate-500 text-sm">Cash and bank balances from the ledger</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={!accounts.length}><Download size={14} /> Export CSV</Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setBankName(''); setBankOpen(true) }}><Plus size={14} /> Bank account</Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setDialog('transfer')} disabled={accounts.length < 2}><ArrowLeftRight size={14} /> Transfer</Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setDialog('expense')} disabled={!accounts.length}><HandCoins size={14} /> Expense</Button>
          <Button size="sm" className="gap-2" onClick={() => setDialog('receipt')} disabled={!accounts.length}><Receipt size={14} /> Receipt</Button>
        </div>
      </div>

      {noGoLive && (
        <p className="text-sm rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
          No go-live date is set, so manual entries are blocked. Set one in Accounts Settings.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-slate-50">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Total cash + bank</p>
            <p className="text-xl font-bold mt-1">{loading ? '…' : formatPKR(meta?.total ?? 0)}</p>
          </CardContent>
        </Card>
        {accounts.map(a => (
          <Card key={a.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500 truncate">{a.code} · {a.name}</p>
                {a.subType === 'BANK' ? <Landmark size={14} className="text-slate-400 shrink-0" /> : <Banknote size={14} className="text-slate-400 shrink-0" />}
              </div>
              <p className={`text-xl font-bold mt-1 ${a.balance < 0 ? 'text-red-600' : ''}`}>{formatPKR(a.balance)}</p>
              {a.isDefaultBank && <Badge variant="secondary" className="mt-1">Default bank</Badge>}
            </CardContent>
          </Card>
        ))}
        {!loading && accounts.length === 0 && <p className="text-sm text-slate-400">No cash or bank accounts found.</p>}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-semibold">Recent entries</h2>
        <AccountSelect accounts={accounts} value={filter} onChange={setFilter} placeholder="All cash & bank" className="w-64 h-8 text-sm" />
        {filter && <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500" onClick={() => setFilter('')}>All accounts</Button>}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-3 py-3 font-medium">Entry</th>
                  <th className="text-left px-3 py-3 font-medium">Accounts / memo</th>
                  <th className="text-right px-4 py-3 font-medium">Net effect</th>
                </tr>
              </thead>
              <tbody>
                {entriesLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b animate-pulse"><td colSpan={4} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td></tr>
                  ))
                ) : entries.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-10 text-slate-400">No cash or bank entries yet.</td></tr>
                ) : entries.map(e => {
                  const eff = effect(e)
                  return (
                    <tr key={e.id} className="border-b">
                      <td className="px-4 py-2 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.entryNumber}</td>
                      <td className="px-3 py-2">
                        <span>{accountsLabel(e)}</span>
                        {e.memo && <span className="text-slate-500"> — {e.memo}</span>}
                      </td>
                      <td className={`px-4 py-2 text-right font-medium ${eff < 0 ? 'text-red-600' : eff > 0 ? 'text-green-700' : ''}`}>{formatPKR(eff)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {(['transfer', 'expense', 'receipt'] as Kind[]).map(k => (
        <EntryDialog key={k} kind={k} open={dialog === k} onOpenChange={o => setDialog(o ? k : null)}
          cashBank={accounts} others={others}
          onPosted={() => { load() }} />
      ))}

      <Dialog open={bankOpen} onOpenChange={setBankOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add bank account</DialogTitle>
            <DialogDescription>Creates a ledger account in the 1010–1099 range. Set it as the default bank in Accounts Settings to receive automatic bank postings.</DialogDescription>
          </DialogHeader>
          <Input className="h-8 text-sm" placeholder="e.g. Meezan Bank — Current" value={bankName} maxLength={80} onChange={e => setBankName(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBankOpen(false)}>Cancel</Button>
            <Button onClick={addBank} disabled={bankSaving}>{bankSaving ? 'Adding…' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
