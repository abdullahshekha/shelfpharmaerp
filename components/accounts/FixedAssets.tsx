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
import { CalendarClock, Download, Pencil, Plus, Trash2, XCircle } from 'lucide-react'
import { AccountSelect } from './AccountSelect'
import { karachiDay, toDateInput, todayKarachi, type Account } from './types'

interface Asset {
  id: string; name: string; category: string | null; notes: string | null; purchaseDate: string
  cost: number; salvageValue: number; usefulLifeMonths: number; status: 'ACTIVE' | 'DISPOSED'; disposedAt: string | null
  paidFromAccountId: string | null; monthlyDepreciation: number; accumulatedDepreciation: number; bookValue: number
  depreciationEntries: number
}
interface Meta { count: number; totalCost: number; totalAccumulated: number; totalBookValue: number }
interface RunRow { assetId: string; name: string; amount?: number; entryNumber?: string; reason?: string }
interface RunResult { month: string; date: string; posted: RunRow[]; skipped: RunRow[]; failed: RunRow[]; totalPosted: number; message?: string }

const newRequestId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Previous completed calendar month in Asia/Karachi as YYYY-MM. */
function previousMonthKarachi(): string {
  const [y, m] = todayKarachi().split('-').map(Number)
  const t = y * 12 + (m - 1) - 1
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

const isFunding = (a: Account) =>
  a.isActive && a.systemKey !== 'AR' && a.systemKey !== 'AP' && a.subType !== 'RECEIVABLE' && a.subType !== 'PAYABLE' &&
  ((a.type === 'ASSET' && (a.subType === 'CASH' || a.subType === 'BANK')) || a.type === 'LIABILITY' || a.type === 'EQUITY')

interface FormState { name: string; category: string; notes: string; purchaseDate: string; cost: string; salvage: string; life: string; fundingId: string }
const emptyForm = (): FormState => ({ name: '', category: '', notes: '', purchaseDate: todayKarachi(), cost: '', salvage: '0', life: '60', fundingId: '' })

export function FixedAssets() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [funding, setFunding] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Asset | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const requestId = useRef('')

  const [runOpen, setRunOpen] = useState(false)
  const [month, setMonth] = useState(previousMonthKarachi())
  const [running, setRunning] = useState(false)
  const runLock = useRef(false)
  const [result, setResult] = useState<RunResult | null>(null)

  const [disposing, setDisposing] = useState<Asset | null>(null)
  const [disposeDate, setDisposeDate] = useState(todayKarachi())
  const [disposeBusy, setDisposeBusy] = useState(false)
  const disposeLock = useRef(false)

  const reqId = useRef(0)
  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([fetch('/api/accounts/fixed-assets'), fetch('/api/accounts/accounts')])
      const j1 = await r1.json().catch(() => ({}))
      const j2 = await r2.json().catch(() => ({}))
      if (id !== reqId.current) return
      if (!r1.ok) { toast.error(j1.error ?? 'Could not load fixed assets'); return }
      setAssets(j1.data ?? [])
      setMeta(j1.meta ?? null)
      if (r2.ok) setFunding((j2.data as Account[]).filter(isFunding))
      else toast.error(j2.error ?? 'Could not load accounts')
    } catch {
      if (id === reqId.current) toast.error('Network error loading fixed assets')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const openAdd = () => { setEditing(null); setForm(emptyForm()); requestId.current = newRequestId(); setFormOpen(true) }
  const openEdit = (a: Asset) => {
    setEditing(a)
    setForm({ name: a.name, category: a.category ?? '', notes: a.notes ?? '', purchaseDate: toDateInput(a.purchaseDate), cost: String(a.cost), salvage: String(a.salvageValue), life: String(a.usefulLifeMonths), fundingId: a.paidFromAccountId ?? '' })
    setFormOpen(true)
  }
  // Cost / life / salvage / date / funding are frozen once depreciation exists (or after disposal).
  const frozen = !!editing && (editing.depreciationEntries > 0 || editing.status === 'DISPOSED')
  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (saveLock.current) return
    const cost = parseFloat(form.cost)
    const salvage = parseFloat(form.salvage || '0')
    const life = Number(form.life)
    if (!form.name.trim()) return toast.error('Enter a name')
    if (!form.purchaseDate) return toast.error('Choose a purchase date')
    if (!Number.isFinite(cost) || cost <= 0) return toast.error('Enter a cost greater than zero')
    if (!Number.isFinite(salvage) || salvage < 0) return toast.error('Salvage value cannot be negative')
    if (!Number.isInteger(life) || life < 1) return toast.error('Useful life must be a whole number of months')
    if (!form.fundingId) return toast.error('Choose the account the asset was paid from')
    saveLock.current = true
    setSaving(true)
    try {
      const common = { name: form.name.trim(), category: form.category.trim() || null, notes: form.notes.trim() || null }
      const body = frozen
        ? common
        : { ...common, purchaseDate: form.purchaseDate, cost: Math.round(cost * 100) / 100, salvageValue: Math.round(salvage * 100) / 100, usefulLifeMonths: life, paidFromAccountId: form.fundingId }
      const res = await fetch(editing ? `/api/accounts/fixed-assets/${editing.id}` : '/api/accounts/fixed-assets', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(editing ? body : { ...body, requestId: requestId.current }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not save asset')
      toast.success(editing ? 'Asset updated' : 'Asset added')
      setFormOpen(false)
      load()
    } catch {
      toast.error('Network error — check the register before retrying')
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  const remove = async (a: Asset) => {
    if (!window.confirm(`Delete "${a.name}"? Its purchase entry will be removed from the ledger.`)) return
    try {
      const res = await fetch(`/api/accounts/fixed-assets/${a.id}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not delete asset')
      toast.success('Asset deleted')
      load()
    } catch {
      toast.error('Network error deleting asset')
    }
  }

  const runDepreciation = async () => {
    if (runLock.current) return
    if (!/^\d{4}-\d{2}$/.test(month)) return toast.error('Choose a month')
    runLock.current = true
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/accounts/fixed-assets/depreciation', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not run depreciation')
      setResult(j.data)
      toast.success(`Posted ${j.data.posted.length} entr${j.data.posted.length === 1 ? 'y' : 'ies'}`)
      load()
    } catch {
      toast.error('Network error — re-running the same month is safe')
    } finally {
      runLock.current = false
      setRunning(false)
    }
  }

  const dispose = async () => {
    if (!disposing || disposeLock.current) return
    if (!disposeDate) return toast.error('Choose a disposal date')
    disposeLock.current = true
    setDisposeBusy(true)
    try {
      const res = await fetch(`/api/accounts/fixed-assets/${disposing.id}/dispose`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: disposeDate }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not dispose asset')
      toast.success(`Disposed — ${formatPKR(j.data.writtenOff)} written off to Other Expenses`)
      setDisposing(null)
      load()
    } catch {
      toast.error('Network error — check the register before retrying')
    } finally {
      disposeLock.current = false
      setDisposeBusy(false)
    }
  }

  const exportCsv = () => downloadCsv(
    `fixed-assets-${todayKarachi()}.csv`,
    ['Name', 'Category', 'Purchase date', 'Cost', 'Salvage', 'Life (months)', 'Monthly depreciation', 'Accumulated', 'Book value', 'Status', 'Disposed on'],
    assets.map(a => [a.name, a.category ?? '', karachiDay(a.purchaseDate), a.cost, a.salvageValue, a.usefulLifeMonths, a.monthlyDepreciation, a.accumulatedDepreciation, a.bookValue, a.status, a.disposedAt ? karachiDay(a.disposedAt) : '']),
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Fixed Assets</h1>
          <p className="text-slate-500 text-sm">Asset register with straight-line monthly depreciation</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={!assets.length}><Download size={14} /> Export CSV</Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setResult(null); setMonth(previousMonthKarachi()); setRunOpen(true) }}><CalendarClock size={14} /> Run depreciation</Button>
          <Button size="sm" className="gap-2" onClick={openAdd}><Plus size={14} /> Add asset</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="bg-slate-50"><CardContent className="p-4"><p className="text-xs text-slate-500">Cost (active assets)</p><p className="text-xl font-bold mt-1">{loading ? '…' : formatPKR(meta?.totalCost ?? 0)}</p></CardContent></Card>
        <Card className="bg-slate-50"><CardContent className="p-4"><p className="text-xs text-slate-500">Accumulated depreciation</p><p className="text-xl font-bold mt-1">{loading ? '…' : formatPKR(meta?.totalAccumulated ?? 0)}</p></CardContent></Card>
        <Card className="bg-slate-50"><CardContent className="p-4"><p className="text-xs text-slate-500">Book value</p><p className="text-xl font-bold mt-1">{loading ? '…' : formatPKR(meta?.totalBookValue ?? 0)}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">Asset</th>
                  <th className="text-left px-3 py-3 font-medium">Purchased</th>
                  <th className="text-right px-3 py-3 font-medium">Cost</th>
                  <th className="text-right px-3 py-3 font-medium">Monthly</th>
                  <th className="text-right px-3 py-3 font-medium">Accumulated</th>
                  <th className="text-right px-3 py-3 font-medium">Book value</th>
                  <th className="text-left px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => <tr key={i} className="border-b animate-pulse"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td></tr>)
                ) : assets.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-slate-400">No fixed assets yet.</td></tr>
                ) : assets.map(a => (
                  <tr key={a.id} className="border-b">
                    <td className="px-4 py-2">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-slate-500">{[a.category, `${a.usefulLifeMonths} mo life`, a.salvageValue > 0 ? `salvage ${formatPKR(a.salvageValue)}` : null].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(a.purchaseDate)}</td>
                    <td className="px-3 py-2 text-right">{formatPKR(a.cost)}</td>
                    <td className="px-3 py-2 text-right">{a.status === 'ACTIVE' ? formatPKR(a.monthlyDepreciation) : '—'}</td>
                    <td className="px-3 py-2 text-right">{formatPKR(a.accumulatedDepreciation)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatPKR(a.bookValue)}</td>
                    <td className="px-3 py-2">
                      {a.status === 'ACTIVE' ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Disposed{a.disposedAt ? ` ${formatDate(a.disposedAt)}` : ''}</Badge>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <Button variant="ghost" size="sm" className="h-8 px-2" title="Edit" onClick={() => openEdit(a)}><Pencil size={14} /></Button>
                      {a.status === 'ACTIVE' && (
                        <Button variant="ghost" size="sm" className="h-8 px-2" title="Dispose" onClick={() => { setDisposeDate(todayKarachi()); setDisposing(a) }}><XCircle size={14} /></Button>
                      )}
                      {a.status === 'ACTIVE' && a.depreciationEntries === 0 && (
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-red-600" title="Delete" onClick={() => remove(a)}><Trash2 size={14} /></Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit asset' : 'Add fixed asset'}</DialogTitle>
            <DialogDescription>
              {editing
                ? frozen ? 'Depreciation has been posted (or the asset is disposed), so only name, category and notes can change.' : 'Changing cost, dates or funding re-posts the purchase entry.'
                : 'Posts Dr Fixed Assets / Cr the account it was paid from.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1"><p className="text-xs text-slate-500 mb-1">Name</p><Input className="h-8 text-sm" value={form.name} onChange={e => set('name', e.target.value)} /></div>
              <div className="flex-1"><p className="text-xs text-slate-500 mb-1">Category</p><Input className="h-8 text-sm" value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Vehicle" /></div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1"><p className="text-xs text-slate-500 mb-1">Cost (Rs.)</p><Input type="number" min={0} step="0.01" className="h-8 text-sm text-right" disabled={frozen} value={form.cost} onChange={e => set('cost', e.target.value)} /></div>
              <div className="flex-1"><p className="text-xs text-slate-500 mb-1">Salvage value (Rs.)</p><Input type="number" min={0} step="0.01" className="h-8 text-sm text-right" disabled={frozen} value={form.salvage} onChange={e => set('salvage', e.target.value)} /></div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1"><p className="text-xs text-slate-500 mb-1">Useful life (months)</p><Input type="number" min={1} step="1" className="h-8 text-sm text-right" disabled={frozen} value={form.life} onChange={e => set('life', e.target.value)} /></div>
              <div className="flex-1"><p className="text-xs text-slate-500 mb-1">Purchase date</p><Input type="date" className="h-8 text-sm" disabled={frozen} value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)} /></div>
            </div>
            <p className="text-xs text-slate-500">Depreciation is straight-line and starts in the purchase month (a full month&apos;s charge, whatever the day).</p>
            <div>
              <p className="text-xs text-slate-500 mb-1">Paid from (cash/bank, or an equity/liability account such as Owner&apos;s Equity)</p>
              {frozen ? (
                <p className="text-sm">{funding.find(a => a.id === form.fundingId) ? `${funding.find(a => a.id === form.fundingId)!.code} · ${funding.find(a => a.id === form.fundingId)!.name}` : '—'}</p>
              ) : (
                <AccountSelect accounts={funding} value={form.fundingId} onChange={id => set('fundingId', id)} className="w-full h-8 text-sm" />
              )}
            </div>
            <div><p className="text-xs text-slate-500 mb-1">Notes</p><Input className="h-8 text-sm" value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save' : 'Add asset'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Run depreciation</DialogTitle>
            <DialogDescription>
              Posts one entry per active asset for the month, dated the last day of the month. Safe to re-run — a month already posted for an asset is skipped.
              The first depreciation month of an asset is its purchase month.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">Month</p>
              <Input type="month" className="h-8 w-48 text-sm" value={month} max={todayKarachi().slice(0, 7)} onChange={e => setMonth(e.target.value)} />
            </div>
            {result && (
              <div className="rounded-md border p-3 text-sm space-y-2 max-h-72 overflow-y-auto">
                {result.message && <p className="text-amber-700">{result.message}</p>}
                <p className="font-medium">Posted {result.posted.length} · skipped {result.skipped.length}{result.failed.length ? ` · failed ${result.failed.length}` : ''} · total {formatPKR(result.totalPosted)}</p>
                {result.posted.map(r => <p key={r.assetId} className="text-green-700">{r.name}: {formatPKR(r.amount ?? 0)} ({r.entryNumber})</p>)}
                {result.skipped.map(r => <p key={r.assetId} className="text-slate-500">{r.name}: {r.reason}</p>)}
                {result.failed.map(r => <p key={r.assetId} className="text-red-600">{r.name}: {r.reason}</p>)}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)}>Close</Button>
            <Button onClick={runDepreciation} disabled={running}>{running ? 'Running…' : 'Run'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!disposing} onOpenChange={o => { if (!o) setDisposing(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dispose {disposing?.name}</DialogTitle>
            <DialogDescription>
              Removes the asset from the books: its accumulated depreciation is cleared and the remaining book value ({formatPKR(disposing?.bookValue ?? 0)}) is written off to Other Expenses. No sale proceeds are recorded — post those as a receipt. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div>
            <p className="text-xs text-slate-500 mb-1">Disposal date</p>
            <Input type="date" className="h-8 w-44 text-sm" value={disposeDate} onChange={e => setDisposeDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisposing(null)}>Cancel</Button>
            <Button variant="destructive" onClick={dispose} disabled={disposeBusy}>{disposeBusy ? 'Disposing…' : 'Dispose'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
