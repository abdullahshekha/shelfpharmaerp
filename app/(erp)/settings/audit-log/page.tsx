'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollText } from 'lucide-react'
import AuditTable from '@/components/audit/AuditTable'
import type { AuditRow } from '@/components/audit/AuditChanges'

const MODELS = ['Auth', 'Account', 'AccountingSettings', 'Area', 'Attendance', 'Category', 'Delivery', 'DeliveryChallan', 'DeleteApproval', 'DrugLicense', 'Employee', 'FixedAsset', 'Invoice', 'JournalEntry', 'Manufacturer', 'Medicine', 'MedicineBatch', 'OfferList', 'OfferListAssignment', 'OfferListCustomer', 'OfferListCustomerItem', 'OfferListItem', 'Order', 'OrderItem', 'Payment', 'PayrollLine', 'PayrollRun', 'PurchaseInvoice', 'PurchaseInvoiceItem', 'Retailer', 'SalesReturn', 'SalesReturnItem', 'Supplier', 'SupplierPayment', 'SupplierReturn', 'SupplierReturnItem', 'WhatsappOrder']
const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'BULK_CREATE', 'BULK_UPDATE', 'BULK_DELETE', 'LOGIN', 'LOGIN_FAILED']
const SEL = 'h-9 rounded-md border border-input bg-background px-2 text-sm'
const EMPTY = { actorId: '', model: '', action: '', from: '', to: '', q: '' }

export default function AuditLogPage() {
  const [f, setF] = useState(EMPTY)
  const [applied, setApplied] = useState(EMPTY)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AuditRow[]>([])
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const sp = new URLSearchParams({ page: String(page), pageSize: '50' })
    for (const [k, v] of Object.entries(applied)) if (v.trim()) sp.set(k, v.trim())
    try {
      const res = await fetch(`/api/audit-log?${sp}`)
      if (res.status === 403 || res.status === 401) { setForbidden(true); return }
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? 'Failed to load the audit log'); setRows([]); return }
      setRows(j.data ?? [])
      setMeta({ total: j.meta?.total ?? 0, totalPages: j.meta?.totalPages ?? 1 })
    } catch { setError('Failed to load the audit log') } finally { setLoading(false) }
  }, [applied, page])

  useEffect(() => { load() }, [load])

  const apply = (e: React.FormEvent) => { e.preventDefault(); setPage(1); setApplied(f) }
  const clear = () => { setF(EMPTY); setApplied(EMPTY); setPage(1) }
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })

  if (forbidden) return <div className="p-6 text-sm text-slate-600">You are not allowed to view the audit log. Only an Admin can.</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ScrollText className="h-6 w-6 text-slate-500" />
        <h1 className="text-2xl font-bold">Audit Log</h1>
      </div>
      <Card>
        <CardContent className="pt-4">
          <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input placeholder="Search order/invoice no. or record id" value={f.q} onChange={set('q')} />
            <Input placeholder="User id (actor id)" value={f.actorId} onChange={set('actorId')} />
            <select className={SEL} value={f.model} onChange={set('model')} aria-label="Table">
              <option value="">All tables</option>
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className={SEL} value={f.action} onChange={set('action')} aria-label="Action">
              <option value="">All actions</option>
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-600">From <Input type="date" value={f.from} onChange={set('from')} /></label>
            <label className="flex items-center gap-2 text-sm text-slate-600">To <Input type="date" value={f.to} onChange={set('to')} /></label>
            <div className="flex gap-2">
              <Button type="submit">Apply</Button>
              <Button type="button" variant="outline" onClick={clear}>Clear</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {loading ? <p className="p-6 text-sm text-slate-500">Loading…</p>
            : error ? <p className="p-6 text-sm text-red-600">{error}</p>
            : rows.length === 0 ? <p className="p-6 text-sm text-slate-500">No audit entries match these filters.</p>
            : <AuditTable rows={rows} />}
        </CardContent>
      </Card>
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{meta.total} {meta.total === 1 ? 'entry' : 'entries'}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages || loading} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div>
  )
}
