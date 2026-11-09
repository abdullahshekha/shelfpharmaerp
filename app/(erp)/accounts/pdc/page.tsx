'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'
import { PartyPicker, type Party } from '@/components/accounts/PartyPicker'
import { ChequeTable, type Bank, type Cheque } from '@/components/pdc/ChequeTable'
import { ChequeForm } from '@/components/pdc/ChequeForm'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { canCreateCheque, canManageCheques } from '@/lib/pdc/guard'
import { formatPKR } from '@/lib/utils/format'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'

type Tab = 'RECEIVABLE' | 'PAYABLE' | 'ALL'
const TABS: { key: Tab; label: string }[] = [
  { key: 'RECEIVABLE', label: 'Receivables' },
  { key: 'PAYABLE', label: 'Payables' },
  { key: 'ALL', label: 'All' },
]
const STATUS_ITEMS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'STOPPED', label: 'Stopped' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'CLEARED', label: 'Cleared' },
]
const PAGE = 20

export default function PdcPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [tab, setTab] = useState<Tab>('RECEIVABLE')
  const [status, setStatus] = useState('ALL')
  const [bank, setBank] = useState('ALL')
  const [dateRange, setDateRange] = useState<DateRange | null>(null)
  const [party, setParty] = useState<Party | null>(null)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [unack, setUnack] = useState(false)
  const [page, setPage] = useState(1)

  const [rows, setRows] = useState<Cheque[]>([])
  const [total, setTotal] = useState(0)
  const [totals, setTotals] = useState({ receivable: 0, payable: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [banks, setBanks] = useState<Bank[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<{ cheque: Cheque; mode: 'FULL' | 'NOTES' } | null>(null)

  const role = user?.role ?? ''
  const isMgr = canManageCheques(role)

  // Debounce the free-text search (cheque # / party / drawer bank).
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!isMgr) return
    fetch('/api/cheques/banks?includeInactive=1')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setBanks(j.data ?? []))
      .catch(() => setBanks([]))
  }, [isMgr])

  // Only the latest request may update the list (a filter change on page N fires a fetch for the old page and then
  // one for page 1; a slow stale response must not overwrite the newer one).
  const reqSeq = useRef(0)
  const fetchRows = useCallback(async () => {
    const seq = ++reqSeq.current
    const stale = () => seq !== reqSeq.current
    setLoading(true)
    setLoadError('')
    const p = new URLSearchParams({ page: String(page) })
    if (tab !== 'ALL') p.set('direction', tab)
    if (status !== 'ALL') p.set('status', status)
    if (bank !== 'ALL') p.set('bankAccountId', bank)
    if (dateRange?.from) p.set('from', dateRange.from)
    if (dateRange?.to) p.set('to', dateRange.to)
    if (party) p.set('partyId', party.id)
    if (q) p.set('q', q)
    if (unack) p.set('acknowledged', 'false')
    try {
      const res = await fetch(`/api/cheques?${p}`)
      const j = await res.json().catch(() => ({}))
      if (stale()) return
      if (!res.ok) {
        setRows([]); setTotal(0); setTotals({ receivable: 0, payable: 0 })
        setLoadError(j.error ?? 'Could not load cheques')
        return
      }
      setRows(j.data ?? [])
      setTotal(j.total ?? 0)
      setTotals(j.totals ?? { receivable: 0, payable: 0 })
    } catch {
      if (!stale()) setLoadError('Network error — could not load cheques')
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [page, tab, status, bank, dateRange, party, q, unack])

  useEffect(() => { setPage(1) }, [tab, status, bank, dateRange, party, q, unack])
  useEffect(() => { if (user) fetchRows() }, [fetchRows, user])

  const switchTab = (t: Tab) => { setTab(t); setParty(null) }
  const anyFilter = status !== 'ALL' || bank !== 'ALL' || !!dateRange || !!party || !!search || unack
  const totalPages = Math.max(1, Math.ceil(total / PAGE))
  const bankItems = [{ value: 'ALL', label: 'All banks' }, ...banks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))]
  const canAdd = !!user && (canCreateCheque(role, 'RECEIVABLE') || canCreateCheque(role, 'PAYABLE'))

  if (!userLoading && user && !isMgr && role !== 'SALESMAN') {
    return <p className="text-slate-500 py-12 text-center">You do not have access to PDC Management.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">PDC Management</h1>
          <p className="text-slate-500 text-sm">Post-dated cheques — nothing is paid until a cheque is cleared. {total} cheque{total === 1 ? '' : 's'}</p>
        </div>
        {canAdd && (
          <Button size="sm" className="gap-2" onClick={() => { setEditing(null); setFormOpen(true) }}>
            <Plus size={16} /> Add cheque
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card><CardContent className="py-3">
          <p className="text-xs text-slate-500">Receivable cheques (from customers)</p>
          <p className="text-lg font-semibold">{formatPKR(totals.receivable)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3">
          <p className="text-xs text-slate-500">Payable cheques (to suppliers)</p>
          <p className="text-lg font-semibold">{formatPKR(totals.payable)}</p>
        </CardContent></Card>
      </div>
      <p className="text-xs text-slate-400 -mt-2">Totals cover every cheque matching the filters (all pages), kept separate per direction.</p>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t.key ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search cheque # / party / drawer bank…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 h-8 text-sm"
        />
        <Select items={STATUS_ITEMS} value={status} onValueChange={(v) => setStatus(v ? String(v) : 'ALL')}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUS_ITEMS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
        {banks.length > 0 && (
          <Select items={bankItems} value={bank} onValueChange={(v) => setBank(v ? String(v) : 'ALL')}>
            <SelectTrigger className="w-48 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{bankItems.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {tab !== 'ALL' && (
          <PartyPicker kind={tab === 'RECEIVABLE' ? 'customer' : 'supplier'} value={party} onChange={setParty} />
        )}
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={unack} onChange={(e) => setUnack(e.target.checked)} />
          Unacknowledged only
        </label>
        {anyFilter && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500"
            onClick={() => { setStatus('ALL'); setBank('ALL'); setDateRange(null); setParty(null); setSearch(''); setUnack(false) }}>
            Clear all
          </Button>
        )}
      </div>
      {dateRange && <p className="text-xs text-slate-400 -mt-2">Date range filters on the cheque date.</p>}

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      <Card>
        <CardContent className="p-0">
          {user && (
            <ChequeTable
              rows={rows}
              loading={loading || userLoading}
              user={{ id: user.id, role: user.role }}
              banks={banks}
              onChanged={fetchRows}
              onEdit={(cheque, mode) => { setEditing({ cheque, mode }); setFormOpen(true) }}
            />
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={15} />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}

      {user && (
        <ChequeForm
          open={formOpen}
          onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null) }}
          role={role}
          banks={banks}
          cheque={editing?.cheque ?? null}
          editMode={editing?.mode ?? 'FULL'}
          defaultDirection={tab === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE'}
          onSaved={fetchRows}
        />
      )}
    </div>
  )
}
