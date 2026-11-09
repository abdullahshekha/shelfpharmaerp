'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { todayKarachi } from '@/components/accounts/types'
import { canAcknowledge, canEditCheque, canManageCheques } from '@/lib/pdc/guard'
import { canTransition, type ChequeDirection, type ChequeStatus } from '@/lib/pdc/rules'
import { CheckCircle2, AlertCircle } from 'lucide-react'

export interface Bank { id: string; code: string; name: string; isActive: boolean }

export interface Cheque {
  id: string
  direction: ChequeDirection
  chequeNumber: string
  amount: string | number
  chequeDate: string
  receivedDate: string
  retailerId: string | null
  supplierId: string | null
  retailer: { id: string; name: string } | null
  supplier: { id: string; name: string } | null
  bankAccountId: string | null
  drawerBank: string | null
  notes: string | null
  status: ChequeStatus
  recordedById: string | null
  acknowledgedAt: string | null
  clearedAt: string | null
}

export interface SessionUser { id: string; role: string }

const STATUS_STYLE: Record<ChequeStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  STOPPED: 'bg-slate-200 text-slate-700 border-slate-300',
  RETURNED: 'bg-red-100 text-red-700 border-red-200',
  CLEARED: 'bg-green-100 text-green-800 border-green-200',
}
const STATUS_LABEL: Record<ChequeStatus, string> = { PENDING: 'Pending', STOPPED: 'Stopped', RETURNED: 'Returned', CLEARED: 'Cleared' }

/** What the API will accept for this user on this cheque (mirrors lib/pdc/guard + rules exactly). */
export function rowActions(user: SessionUser, c: Cheque) {
  const mgr = canManageCheques(user.role)
  const acknowledged = !!c.acknowledgedAt
  return {
    acknowledge: canAcknowledge(user.role) && !acknowledged,
    stop: mgr && canTransition(c.status, 'STOPPED'),
    ret: mgr && canTransition(c.status, 'RETURNED'),
    represent: mgr && canTransition(c.status, 'PENDING'),
    clear: mgr && canTransition(c.status, 'CLEARED') && acknowledged,
    edit: user.id ? canEditCheque(user, { status: c.status, recordedById: c.recordedById, acknowledgedAt: c.acknowledgedAt ? new Date(c.acknowledgedAt) : null }) : false,
  }
}

function ClearDialog({ cheque, banks, onClose, onCleared }: { cheque: Cheque | null; banks: Bank[]; onClose: () => void; onCleared: () => void }) {
  const [date, setDate] = useState(todayKarachi())
  const [bank, setBank] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    if (cheque) { setDate(todayKarachi()); setBank(cheque.bankAccountId ?? ''); setError('') }
  }, [cheque])

  const active = banks.filter((b) => b.isActive)
  const items = active.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))

  const submit = async () => {
    if (!cheque || busy.current) return
    setError('')
    if (!date) return setError('Enter the clearing date')
    if (date > todayKarachi()) return setError('Clearing date cannot be in the future')
    if (!bank) return setError('Choose the bank account the cheque was cleared into')
    busy.current = true
    setSaving(true)
    try {
      const res = await fetch(`/api/cheques/${cheque.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clear', clearingDate: date, bankAccountId: bank }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? 'Could not clear the cheque'); return }
      const n = Array.isArray(j.payments) ? j.payments.length : 0
      toast.success(`Cheque cleared — ${n} invoice payment${n === 1 ? '' : 's'} recorded`)
      onClose()
      onCleared()
    } catch {
      setError('Network error — reload the list to see whether it cleared before retrying')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!cheque} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clear cheque {cheque?.chequeNumber}</DialogTitle>
          <DialogDescription>
            {cheque && `${formatPKR(cheque.amount)} — pays ${cheque.direction === 'RECEIVABLE' ? "the customer's" : "the supplier's"} oldest unpaid invoices first. Clearing is final.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Clearing date *</Label>
            <Input type="date" className="h-8 text-sm" max={todayKarachi()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bank account *</Label>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">No active bank account exists. Add one in Cash &amp; Bank Management.</p>
            ) : (
              <Select items={items} value={bank || null} onValueChange={(v) => setBank(v ? String(v) : '')}>
                <SelectTrigger className="w-full h-8 text-sm"><SelectValue placeholder="Select bank account" /></SelectTrigger>
                <SelectContent>
                  {items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          {error && (
            <p className="flex items-start gap-1.5 text-sm text-red-600 font-medium" role="alert">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Clearing…' : 'Mark cleared'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface Props {
  rows: Cheque[]
  loading: boolean
  user: SessionUser
  banks: Bank[]
  onChanged: () => void
  onEdit: (c: Cheque, mode: 'FULL' | 'NOTES') => void
}

export function ChequeTable({ rows, loading, user, banks, onChanged, onEdit }: Props) {
  const [clearing, setClearing] = useState<Cheque | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const bankName = (id: string | null) => {
    if (!id) return null
    const b = banks.find((x) => x.id === id)
    return b ? b.name : 'Bank account'
  }

  const act = async (c: Cheque, action: 'acknowledge' | 'stop' | 'return' | 'represent', confirmText?: string) => {
    if (busyId) return
    if (confirmText && !confirm(confirmText)) return
    setBusyId(c.id)
    try {
      const res = await fetch(`/api/cheques/${c.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(j.error ?? 'Action failed')
      else toast.success({ acknowledge: 'Cheque acknowledged', stop: 'Cheque marked Stopped', return: 'Cheque marked Returned', represent: 'Cheque back to Pending' }[action])
      onChanged()
    } catch {
      toast.error('Network error — reload and retry')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-slate-600">
              <th className="text-left px-4 py-3 font-medium">Cheque #</th>
              <th className="text-left px-4 py-3 font-medium">Party</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
              <th className="text-left px-4 py-3 font-medium">Cheque date</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Bank</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Ack.</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b animate-pulse">
                  <td colSpan={8} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400">No cheques match these filters.</td></tr>
            ) : rows.map((c) => {
              const a = rowActions(user, c)
              const party = c.retailer?.name ?? c.supplier?.name ?? '—'
              const disabled = busyId === c.id
              return (
                <tr key={c.id} className="border-b align-top">
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs">{c.chequeNumber}</p>
                    <p className="text-[11px] text-slate-400">{c.direction === 'RECEIVABLE' ? 'Receivable' : 'Payable'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{party}</p>
                    {c.notes && <p className="text-xs text-slate-400 max-w-[14rem] truncate" title={c.notes}>{c.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{formatPKR(c.amount)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDate(c.chequeDate)}
                    {c.clearedAt && <p className="text-[11px] text-slate-400">cleared {formatDate(c.clearedAt)}</p>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {bankName(c.bankAccountId) ?? <span className="text-slate-400">—</span>}
                    {c.drawerBank && <p className="text-[11px] text-slate-400">drawn on {c.drawerBank}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={STATUS_STYLE[c.status]}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {c.acknowledgedAt
                      ? <CheckCircle2 size={16} className="text-green-600" aria-label="Acknowledged" />
                      : <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">Unacknowledged</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      {a.acknowledge && <Button size="xs" variant="outline" disabled={disabled} onClick={() => act(c, 'acknowledge')}>Acknowledge</Button>}
                      {a.clear && <Button size="xs" disabled={disabled} onClick={() => setClearing(c)}>Clear</Button>}
                      {a.represent && <Button size="xs" variant="outline" disabled={disabled} onClick={() => act(c, 'represent', `Put cheque ${c.chequeNumber} back to Pending (re-present)?`)}>Re-present</Button>}
                      {a.ret && <Button size="xs" variant="outline" disabled={disabled} onClick={() => act(c, 'return', `Mark cheque ${c.chequeNumber} as Returned (bounced)?`)}>Return</Button>}
                      {a.stop && <Button size="xs" variant="outline" disabled={disabled} onClick={() => act(c, 'stop', `Mark cheque ${c.chequeNumber} as Stopped?`)}>Stop</Button>}
                      {a.edit && <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onEdit(c, a.edit as 'FULL' | 'NOTES')}>{a.edit === 'NOTES' ? 'Notes' : 'Edit'}</Button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ClearDialog cheque={clearing} banks={banks} onClose={() => setClearing(null)} onCleared={onChanged} />
    </>
  )
}
