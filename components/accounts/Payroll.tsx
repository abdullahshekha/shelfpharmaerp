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
import { ArrowLeft, Banknote, Download, Plus, RotateCcw, Send, Trash2 } from 'lucide-react'
import { AccountSelect } from './AccountSelect'
import { todayKarachi, type Account } from './types'

interface Totals { count: number; salary: number; deduction: number; bonus: number; net: number }
interface RunSummary { id: string; month: string; status: 'DRAFT' | 'POSTED' | 'PAID'; updatedAt: string; totals: Totals }
interface Line {
  id: string; employeeId: string; employeeName: string; role: string | null; baseSalary: number; absentDays: number; halfDays: number
  autoDeduction: number; deduction: number; bonus: number; netPay: number; note: string | null; joinedMidMonth: boolean
}
interface Detail { id: string; month: string; status: 'DRAFT' | 'POSTED' | 'PAID'; updatedAt: string; lines: Line[]; totals: Totals; entries: { id: string; entryNumber: string; date: string; sourceType: string }[] }
interface Emp { id: string; name: string; role: string; salary: number }
interface Edit { deduction: string; bonus: string; note: string }

const newRequestId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
const r2 = (n: number) => Math.round(n * 100) / 100
const statusBadge = (s: string) => s === 'PAID' ? <Badge>Paid</Badge> : s === 'POSTED' ? <Badge variant="secondary">Posted</Badge> : <Badge variant="outline">Draft</Badge>
const isCashBank = (a: Account) => a.type === 'ASSET' && (a.subType === 'CASH' || a.subType === 'BANK') && a.isActive

export function Payroll() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [dirty, setDirty] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [month, setMonth] = useState(todayKarachi().slice(0, 7))
  const [pickEmps, setPickEmps] = useState(false)
  const [emps, setEmps] = useState<Emp[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const createLock = useRef(false)

  const [payOpen, setPayOpen] = useState(false)
  const [cashAccounts, setCashAccounts] = useState<Account[]>([])
  const [fromId, setFromId] = useState('')
  const [payDate, setPayDate] = useState(todayKarachi())
  const payRequestId = useRef('')
  const [busy, setBusy] = useState(false)
  const busyLock = useRef(false)

  const reqId = useRef(0)
  const loadRuns = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const res = await fetch('/api/accounts/payroll')
      const j = await res.json().catch(() => ({}))
      if (id !== reqId.current) return
      if (!res.ok) { toast.error(j.error ?? 'Could not load payroll runs'); return }
      setRuns(j.data ?? [])
    } catch {
      if (id === reqId.current) toast.error('Network error loading payroll runs')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])
  useEffect(() => { loadRuns() }, [loadRuns])

  const applyDetail = (d: Detail) => {
    setDetail(d)
    setDirty(false)
    setEdits(Object.fromEntries(d.lines.map(l => [l.id, { deduction: String(l.deduction), bonus: String(l.bonus), note: l.note ?? '' }])))
  }

  const detailReq = useRef(0)
  const openRun = async (id: string) => {
    const n = ++detailReq.current
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/accounts/payroll/${id}`)
      const j = await res.json().catch(() => ({}))
      if (n !== detailReq.current) return
      if (!res.ok) { toast.error(j.error ?? 'Could not load payroll run'); return }
      applyDetail(j.data)
    } catch {
      if (n === detailReq.current) toast.error('Network error loading payroll run')
    } finally {
      if (n === detailReq.current) setDetailLoading(false)
    }
  }
  const closeDetail = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    detailReq.current++
    setDetail(null)
    loadRuns()
  }

  const openCreate = async () => {
    setMonth(todayKarachi().slice(0, 7)); setPickEmps(false); setSelected(new Set()); setCreateOpen(true)
    try {
      const res = await fetch('/api/accounts/payroll/employees')
      const j = await res.json().catch(() => ({}))
      if (res.ok) setEmps(j.data ?? [])
    } catch { /* optional list */ }
  }

  const create = async () => {
    if (createLock.current) return
    if (!/^\d{4}-\d{2}$/.test(month)) return toast.error('Choose a month')
    if (pickEmps && selected.size === 0) return toast.error('Select at least one employee')
    createLock.current = true
    setCreating(true)
    try {
      const res = await fetch('/api/accounts/payroll', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month, ...(pickEmps ? { employeeIds: Array.from(selected) } : {}) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not create payroll run')
      toast.success(`Payroll run for ${month} created`)
      setCreateOpen(false)
      applyDetail(j.data)
      loadRuns()
    } catch {
      toast.error('Network error — check the runs list before retrying')
    } finally {
      createLock.current = false
      setCreating(false)
    }
  }

  const setEdit = (id: string, k: keyof Edit, v: string) => {
    setEdits(e => ({ ...e, [id]: { ...e[id], [k]: v } }))
    setDirty(true)
  }
  const num = (s: string) => (s.trim() === '' ? 0 : Number(s))
  const previewNet = (l: Line) => {
    const e = edits[l.id]
    if (!e) return l.netPay
    const d = num(e.deduction), b = num(e.bonus)
    return Number.isFinite(d) && Number.isFinite(b) ? r2(l.baseSalary - d + b) : l.netPay
  }

  const guarded = async (fn: () => Promise<void>) => {
    if (busyLock.current) return
    busyLock.current = true
    setBusy(true)
    try { await fn() } finally { busyLock.current = false; setBusy(false) }
  }

  const saveLines = () => guarded(async () => {
    if (!detail) return
    for (const l of detail.lines) {
      const e = edits[l.id]
      const d = num(e.deduction), b = num(e.bonus)
      if (!Number.isFinite(d) || d < 0 || d > l.baseSalary) return void toast.error(`${l.employeeName}: deduction must be between 0 and ${l.baseSalary}`)
      if (!Number.isFinite(b) || b < 0 || b > 1e8) return void toast.error(`${l.employeeName}: bonus must be 0 or more`)
    }
    try {
      const res = await fetch(`/api/accounts/payroll/${detail.id}/lines`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: detail.updatedAt, lines: detail.lines.map(l => ({ id: l.id, deduction: r2(num(edits[l.id].deduction)), bonus: r2(num(edits[l.id].bonus)), note: edits[l.id].note })) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return void toast.error(j.error ?? 'Could not save lines')
      toast.success('Saved')
      applyDetail(j.data)
    } catch {
      toast.error('Network error — reload the run before retrying')
    }
  })

  const action = (path: string, okMsg: string, confirmMsg?: string) => guarded(async () => {
    if (!detail) return
    if (dirty) return void toast.error('Save or discard your line changes first')
    if (confirmMsg && !window.confirm(confirmMsg)) return
    try {
      const res = await fetch(`/api/accounts/payroll/${detail.id}/${path}`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return void toast.error(j.error ?? 'Action failed')
      toast.success(okMsg)
      applyDetail(j.data)
      loadRuns()
    } catch {
      toast.error('Network error — reload the run to see its current state')
    }
  })

  const removeRun = () => guarded(async () => {
    if (!detail) return
    if (!window.confirm(`Delete the draft payroll run for ${detail.month}?`)) return
    try {
      const res = await fetch(`/api/accounts/payroll/${detail.id}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return void toast.error(j.error ?? 'Could not delete run')
      toast.success('Run deleted')
      setDetail(null)
      setDirty(false)
      loadRuns()
    } catch {
      toast.error('Network error deleting run')
    }
  })

  const openPay = async () => {
    if (dirty) return toast.error('Save or discard your line changes first')
    payRequestId.current = newRequestId()
    setPayDate(todayKarachi()); setFromId(''); setPayOpen(true)
    try {
      const res = await fetch('/api/accounts/accounts')
      const j = await res.json().catch(() => ({}))
      if (res.ok) setCashAccounts((j.data as Account[]).filter(isCashBank))
      else toast.error(j.error ?? 'Could not load accounts')
    } catch { toast.error('Network error loading accounts') }
  }
  const pay = () => guarded(async () => {
    if (!detail) return
    if (!fromId) return void toast.error('Choose the cash/bank account')
    if (!payDate) return void toast.error('Choose a payment date')
    try {
      const res = await fetch(`/api/accounts/payroll/${detail.id}/pay`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromAccountId: fromId, date: payDate, requestId: payRequestId.current }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return void toast.error(j.error ?? 'Could not record payment')
      toast.success('Salaries marked as paid')
      setPayOpen(false)
      applyDetail(j.data)
      loadRuns()
    } catch {
      toast.error('Network error — reload the run before retrying')
    }
  })

  const exportCsv = () => {
    if (!detail) return
    downloadCsv(
      `payroll-${detail.month}.csv`,
      ['Employee', 'Role', 'Base salary', 'Absent days', 'Half days', 'Deduction', 'Bonus', 'Net pay', 'Note'],
      detail.lines.map(l => [l.employeeName, l.role ?? '', l.baseSalary, l.absentDays, l.halfDays, l.deduction, l.bonus, l.netPay, l.note ?? '']),
    )
  }

  // ---------------- detail view ----------------
  if (detail || detailLoading) {
    const draft = detail?.status === 'DRAFT'
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" aria-label="Back to payroll runs" onClick={closeDetail}><ArrowLeft size={16} /></Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">Payroll {detail?.month ?? '…'} {detail && statusBadge(detail.status)}</h1>
              <p className="text-slate-500 text-sm">Deductions default to salary ÷ 30 per absent day (half for half days). Leave counts as present.</p>
            </div>
          </div>
          {detail && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv}><Download size={14} /> Export CSV</Button>
              {draft && <Button variant="outline" size="sm" className="gap-2 text-red-600" disabled={busy} onClick={removeRun}><Trash2 size={14} /> Delete</Button>}
              {draft && <Button variant="outline" size="sm" disabled={busy || !dirty} onClick={saveLines}>Save changes</Button>}
              {draft && <Button size="sm" className="gap-2" disabled={busy} onClick={() => action('post', 'Payroll posted to the ledger', `Post payroll for ${detail.month}? This books ${formatPKR(detail.totals.net)} as salaries expense and payable.`)}><Send size={14} /> Post</Button>}
              {detail.status === 'POSTED' && <Button variant="outline" size="sm" className="gap-2" disabled={busy} onClick={() => action('reopen', 'Run re-opened as draft', 'Re-open this run? Its ledger entry will be removed.')}><RotateCcw size={14} /> Re-open</Button>}
              {detail.status === 'POSTED' && <Button size="sm" className="gap-2" disabled={busy} onClick={openPay}><Banknote size={14} /> Mark paid</Button>}
            </div>
          )}
        </div>

        {detail && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Card className="bg-slate-50"><CardContent className="p-4"><p className="text-xs text-slate-500">Employees</p><p className="text-xl font-bold mt-1">{detail.totals.count}</p></CardContent></Card>
              <Card className="bg-slate-50"><CardContent className="p-4"><p className="text-xs text-slate-500">Gross salary</p><p className="text-xl font-bold mt-1">{formatPKR(detail.totals.salary)}</p></CardContent></Card>
              <Card className="bg-slate-50"><CardContent className="p-4"><p className="text-xs text-slate-500">Deductions / bonus</p><p className="text-xl font-bold mt-1">{formatPKR(detail.totals.deduction)} / {formatPKR(detail.totals.bonus)}</p></CardContent></Card>
              <Card className="bg-slate-50"><CardContent className="p-4"><p className="text-xs text-slate-500">Net pay</p><p className="text-xl font-bold mt-1">{formatPKR(detail.totals.net)}</p></CardContent></Card>
            </div>
            {detail.entries.length > 0 && (
              <p className="text-xs text-slate-500">Ledger entries: {detail.entries.map(e => `${e.entryNumber} (${e.sourceType === 'PAYROLL' ? 'payroll' : 'payment'}, ${formatDate(e.date)})`).join(' · ')}</p>
            )}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50 text-slate-600">
                        <th className="text-left px-4 py-3 font-medium">Employee</th>
                        <th className="text-right px-3 py-3 font-medium">Salary</th>
                        <th className="text-right px-3 py-3 font-medium">Absent</th>
                        <th className="text-right px-3 py-3 font-medium">Half</th>
                        <th className="text-right px-3 py-3 font-medium">Deduction</th>
                        <th className="text-right px-3 py-3 font-medium">Bonus</th>
                        <th className="text-right px-3 py-3 font-medium">Net pay</th>
                        <th className="text-left px-3 py-3 font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map(l => {
                        const e = edits[l.id] ?? { deduction: String(l.deduction), bonus: String(l.bonus), note: l.note ?? '' }
                        return (
                          <tr key={l.id} className="border-b">
                            <td className="px-4 py-2">
                              <p className="font-medium">{l.employeeName}</p>
                              <p className="text-xs text-slate-500">{l.role}</p>
                              {l.joinedMidMonth && <p className="text-xs text-amber-700">Joined mid-month — not pro-rated, adjust the deduction if needed</p>}
                            </td>
                            <td className="px-3 py-2 text-right">{formatPKR(l.baseSalary)}</td>
                            <td className="px-3 py-2 text-right">{l.absentDays}</td>
                            <td className="px-3 py-2 text-right">{l.halfDays}</td>
                            <td className="px-3 py-2 text-right">
                              {draft ? <Input type="number" min={0} max={l.baseSalary} step="0.01" aria-label={`Deduction for ${l.employeeName}`} className="h-8 w-28 text-sm text-right ml-auto" value={e.deduction} onChange={ev => setEdit(l.id, 'deduction', ev.target.value)} /> : formatPKR(l.deduction)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {draft ? <Input type="number" min={0} step="0.01" aria-label={`Bonus for ${l.employeeName}`} className="h-8 w-28 text-sm text-right ml-auto" value={e.bonus} onChange={ev => setEdit(l.id, 'bonus', ev.target.value)} /> : formatPKR(l.bonus)}
                            </td>
                            <td className="px-3 py-2 text-right font-medium">{formatPKR(draft ? previewNet(l) : l.netPay)}</td>
                            <td className="px-3 py-2">
                              {draft ? <Input aria-label={`Note for ${l.employeeName}`} className="h-8 w-40 text-sm" maxLength={300} value={e.note} onChange={ev => setEdit(l.id, 'note', ev.target.value)} /> : <span className="text-slate-500">{l.note}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <Dialog open={payOpen} onOpenChange={setPayOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Mark salaries paid</DialogTitle>
              <DialogDescription>Pays the whole run ({formatPKR(detail?.totals.net ?? 0)}) at once: clears Salaries Payable and reduces the chosen cash/bank account. A paid run cannot be re-opened.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div><p className="text-xs text-slate-500 mb-1">Paid from</p><AccountSelect accounts={cashAccounts} value={fromId} onChange={setFromId} className="w-full h-8 text-sm" /></div>
              <div><p className="text-xs text-slate-500 mb-1">Payment date</p><Input type="date" max={todayKarachi()} className="h-8 w-44 text-sm" value={payDate} onChange={e => setPayDate(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
              <Button onClick={pay} disabled={busy}>{busy ? 'Saving…' : 'Mark paid'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ---------------- list view ----------------
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Payroll</h1>
          <p className="text-slate-500 text-sm">Monthly salary runs from active employees, with attendance-based deductions</p>
        </div>
        <Button size="sm" className="gap-2" onClick={openCreate}><Plus size={14} /> New payroll run</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">Month</th>
                  <th className="text-left px-3 py-3 font-medium">Status</th>
                  <th className="text-right px-3 py-3 font-medium">Employees</th>
                  <th className="text-right px-3 py-3 font-medium">Gross</th>
                  <th className="text-right px-3 py-3 font-medium">Deductions</th>
                  <th className="text-right px-3 py-3 font-medium">Bonus</th>
                  <th className="text-right px-3 py-3 font-medium">Net pay</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => <tr key={i} className="border-b animate-pulse"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td></tr>)
                ) : runs.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-slate-400">No payroll runs yet.</td></tr>
                ) : runs.map(r => (
                  <tr key={r.id} className="border-b">
                    <td className="px-4 py-2 font-medium">{r.month}</td>
                    <td className="px-3 py-2">{statusBadge(r.status)}</td>
                    <td className="px-3 py-2 text-right">{r.totals.count}</td>
                    <td className="px-3 py-2 text-right">{formatPKR(r.totals.salary)}</td>
                    <td className="px-3 py-2 text-right">{formatPKR(r.totals.deduction)}</td>
                    <td className="px-3 py-2 text-right">{formatPKR(r.totals.bonus)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatPKR(r.totals.net)}</td>
                    <td className="px-3 py-2 text-right"><Button variant="outline" size="sm" onClick={() => openRun(r.id)}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New payroll run</DialogTitle>
            <DialogDescription>Includes every active employee with a salary, with absences and half days counted from Attendance. One run per month.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">Month</p>
              <Input type="month" aria-label="Payroll month" className="h-8 w-48 text-sm" value={month} max={todayKarachi().slice(0, 7)} onChange={e => setMonth(e.target.value)} />
              {month === todayKarachi().slice(0, 7) && (
                <p className="text-xs text-amber-700 mt-1">This is the current month: the payroll entry is dated month end, and the payment can be recorded after that date.</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pickEmps} onChange={e => setPickEmps(e.target.checked)} /> Select employees (default: all)
            </label>
            {pickEmps && (
              <div className="max-h-56 overflow-y-auto rounded-md border p-2 space-y-1">
                {emps.length === 0 && <p className="text-sm text-slate-400">No eligible employees.</p>}
                {emps.map(e => (
                  <label key={e.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => setSelected(s => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n })} />
                    {e.name} <span className="text-slate-400">({e.role})</span> <span className="ml-auto text-slate-500">{formatPKR(e.salary)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={creating}>{creating ? 'Creating…' : 'Create run'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
