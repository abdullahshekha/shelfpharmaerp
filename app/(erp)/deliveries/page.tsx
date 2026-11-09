'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { boardColumn, type BoardColumn } from '@/lib/orders/status'
import { cardActions, type CardAction } from '@/lib/deliveries/ui-helpers'
import { ASSIGNEE_ROLES, canManageAssignments } from '@/lib/deliveries/assign-rules'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { FileDown, Printer, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'
import { DeliveryCard } from '@/components/deliveries/DeliveryCard'
import { AssignDialog } from '@/components/deliveries/AssignDialog'
import { OutcomeDialog } from '@/components/deliveries/OutcomeDialog'
import type { Assignee, BoardDelivery } from '@/components/deliveries/types'

const COLUMNS: { key: BoardColumn; title: string; tone: string }[] = [
  { key: 'READY', title: 'Ready to Dispatch', tone: 'border-blue-200 bg-blue-50/40' },
  { key: 'ASSIGNED', title: 'Delivery Assigned', tone: 'border-orange-200 bg-orange-50/40' },
  { key: 'DELIVERED', title: 'Delivered', tone: 'border-green-200 bg-green-50/40' },
  { key: 'RETURNED', title: 'Returned', tone: 'border-purple-200 bg-purple-50/40' },
  { key: 'ON_HOLD', title: 'On Hold', tone: 'border-yellow-200 bg-yellow-50/40' },
]

const karachiDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })

function todayRange(): DateRange {
  const s = karachiDay(new Date())
  return { from: s, to: s, label: 'Today' }
}

type AssignTarget = { mode: 'assign' | 'reassign'; ids: string[] }

export default function DeliveriesPage() {
  const { user } = useCurrentUser()
  const role = user?.role ?? ''
  const userId = user?.id ?? ''
  const manager = canManageAssignments(role)

  const [dateRange, setDateRange] = useState<DateRange>(todayRange())
  const [deliveries, setDeliveries] = useState<BoardDelivery[]>([])
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [loading, setLoading] = useState(true)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null)
  const [assignBusy, setAssignBusy] = useState(false)
  const [outcomeFor, setOutcomeFor] = useState<BoardDelivery | null>(null)

  // Open work (invoiced, out for delivery, on hold) is shown whatever its date, so overdue and held cards never drop
  // off; the date range only narrows the finished columns (Delivered, Returned).
  const fetchDeliveries = useCallback(async () => {
    setLoading(true)
    const range = new URLSearchParams({ from: dateRange.from, to: dateRange.to, orderStatus: 'DELIVERED,RETURNED' })
    const open = new URLSearchParams({ orderStatus: 'INVOICED,OUT_FOR_DELIVERY,ON_HOLD' })
    try {
      const [o, c] = await Promise.all([
        fetch(`/api/deliveries?${open}`).then(r => r.json()),
        fetch(`/api/deliveries?${range}`).then(r => r.json()),
      ])
      setDeliveries([...(o.data ?? []), ...(c.data ?? [])])
    } catch {
      toast.error('Could not load deliveries')
    }
    setSelected(new Set())
    setLoading(false)
  }, [dateRange])

  useEffect(() => { fetchDeliveries() }, [fetchDeliveries])
  useEffect(() => {
    if (!manager) return
    fetch(`/api/employees?role=${ASSIGNEE_ROLES.join(',')}`).then(r => r.json()).then(j => setAssignees(j.data ?? [])).catch(() => {})
  }, [manager])

  const post = async (url: string, body: object, okMsg: string, id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(okMsg)
        for (const w of j.warnings ?? []) toast.warning(w)
        fetchDeliveries()
      } else toast.error(j.error ?? 'Failed')
    } finally {
      setBusyId(null)
    }
  }

  const confirmAssign = async (assigneeId: string) => {
    if (!assignTarget) return
    setAssignBusy(true)
    try {
      if (assignTarget.mode === 'reassign') {
        const id = assignTarget.ids[0]
        const res = await fetch(`/api/deliveries/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driverId: assigneeId }),
        })
        const j = await res.json().catch(() => ({}))
        if (res.ok) toast.success('Reassigned'); else toast.error(j.error ?? 'Failed to reassign')
      } else if (assignTarget.ids.length === 1) {
        const res = await fetch(`/api/deliveries/${assignTarget.ids[0]}/assign`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driverId: assigneeId }),
        })
        const j = await res.json().catch(() => ({}))
        if (res.ok) { toast.success('Assigned: out for delivery'); for (const w of j.warnings ?? []) toast.warning(w) }
        else toast.error(j.error ?? 'Failed to assign')
      } else {
        const res = await fetch('/api/deliveries/bulk', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: assignTarget.ids, driverId: assigneeId }),
        })
        const j = await res.json().catch(() => ({}))
        if (res.ok) {
          const assigned = Array.isArray(j.assigned) ? j.assigned.length : Number(j.assigned ?? 0)
          if (assigned > 0) toast.success(`Assigned ${assigned} deliveries`)
          const refused: { id: string; error?: string }[] = Array.isArray(j.refused) ? j.refused : []
          for (const r of refused) {
            const num = deliveries.find(x => x.id === r.id)?.order.orderNumber ?? r.id
            toast.error(`${num}: ${r.error ?? 'could not be assigned'}`)
          }
        } else toast.error(j.error ?? 'Failed to assign')
      }
      setAssignTarget(null)
      fetchDeliveries()
    } finally {
      setAssignBusy(false)
    }
  }

  const onAction = (d: BoardDelivery, a: CardAction) => {
    if (a === 'assign') setAssignTarget({ mode: 'assign', ids: [d.id] })
    else if (a === 'reassign') setAssignTarget({ mode: 'reassign', ids: [d.id] })
    else if (a === 'outcome') setOutcomeFor(d)
    else if (a === 'unassign') {
      if (window.confirm('Un-assign this delivery? The stock goes back on the shelf and the order returns to Ready to Dispatch.')) {
        post(`/api/deliveries/${d.id}/assign`, { unassign: true }, 'Un-assigned', d.id)
      }
    }
  }

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const placed = useMemo(() => {
    const now = new Date()
    const m: Record<BoardColumn, BoardDelivery[]> = { READY: [], ASSIGNED: [], DELIVERED: [], RETURNED: [], ON_HOLD: [] }
    for (const d of deliveries) {
      const col = boardColumn(d.order, { scheduledDate: new Date(d.scheduledDate) }, now)
      if (col) m[col].push(d)
    }
    return m
  }, [deliveries])

  const shown = COLUMNS.reduce((n, c) => n + placed[c.key].length, 0)
  const total = COLUMNS.reduce((s, c) => s + placed[c.key].reduce((t, d) => t + Number(d.order.invoice?.totalAmount ?? d.order.totalAmount), 0), 0)

  const pdfUrl = `/api/deliveries/print?from=${dateRange.from}&to=${dateRange.to}`

  // Fetch first so an empty range shows a message instead of saving the JSON error body as a file.
  const downloadPdf = async (url: string, key: string) => {
    setPdfBusy(key)
    try {
      const res = await fetch(url)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast.error(j.error ?? 'Could not generate the PDF')
        return
      }
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'deliveries.pdf'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      toast.error('Could not generate the PDF')
    } finally {
      setPdfBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck size={22} /> Deliveries</h1>
          <p className="text-slate-500 text-sm">
            {shown} on the board · {placed.DELIVERED.length} delivered in range · {formatPKR(total)}
          </p>
        </div>
        {manager && (
          <details className="relative">
            <summary className="list-none cursor-pointer inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">
              <Printer size={14} /> Print
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border bg-white p-1 shadow-lg flex flex-col">
              {[
                { label: 'Area-wise PDF', url: `${pdfUrl}&groupBy=area`, key: 'area' },
                { label: 'Driver-wise PDF', url: `${pdfUrl}&groupBy=driver`, key: 'driver' },
                { label: 'Challans PDF', url: `/api/deliveries/challans?from=${dateRange.from}&to=${dateRange.to}`, key: 'challans' },
              ].map(o => (
                <button key={o.key} disabled={!!pdfBusy} onClick={() => downloadPdf(o.url, o.key)}
                  className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50">
                  <FileDown size={14} /> {o.label}
                </button>
              ))}
              <button onClick={() => window.print()} className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-slate-50">
                <Printer size={14} /> Print manifest
              </button>
            </div>
          </details>
        )}
      </div>

      <div className="print:hidden"><DateRangePicker value={dateRange} onChange={setDateRange} /></div>

      {manager && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-blue-50 p-2 print:hidden">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" onClick={() => setAssignTarget({ mode: 'assign', ids: Array.from(selected) })}>Assign selected</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold">Shelf Pharma - Delivery Manifest</h1>
        <p className="text-slate-600">
          {dateRange.from === dateRange.to ? formatDate(dateRange.from) : `${formatDate(dateRange.from)} to ${formatDate(dateRange.to)}`}
          {' '}· {shown} deliveries · Total: {formatPKR(total)}
        </p>
      </div>

      {loading ? (
        <div className="animate-pulse p-8 text-slate-400">Loading...</div>
      ) : shown === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-400">No deliveries on the board for {dateRange.label}</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {COLUMNS.map(c => (
            <div key={c.key} className={`rounded-xl border p-3 space-y-3 ${c.tone}`}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">{c.title}</h2>
                <Badge variant="outline" className="text-xs">{placed[c.key].length}</Badge>
              </div>
              {placed[c.key].length === 0
                ? <p className="text-xs text-slate-400 py-4 text-center">Nothing here</p>
                : placed[c.key].map(d => {
                    const actions = cardActions(role, userId, { driverId: d.driverId }, c.key)
                    return (
                      <DeliveryCard key={d.id} delivery={d} column={c.key} actions={actions} busy={busyId === d.id}
                        selectable={manager && actions.includes('assign')} selected={selected.has(d.id)}
                        onToggle={() => toggle(d.id)} onAction={a => onAction(d, a)} />
                    )
                  })}
            </div>
          ))}
        </div>
      )}

      <AssignDialog
        open={!!assignTarget}
        title={assignTarget?.mode === 'reassign' ? 'Reassign delivery' : assignTarget && assignTarget.ids.length > 1 ? `Assign ${assignTarget.ids.length} deliveries` : 'Assign delivery'}
        description={assignTarget?.mode === 'reassign' ? 'Hands the delivery to someone else. Stock is not affected.' : undefined}
        confirmLabel={assignTarget?.mode === 'reassign' ? 'Reassign' : 'Assign'}
        assignees={assignees} busy={assignBusy}
        onClose={() => setAssignTarget(null)} onConfirm={confirmAssign}
      />
      <OutcomeDialog delivery={outcomeFor} onClose={() => setOutcomeFor(null)} onDone={() => { setOutcomeFor(null); fetchDeliveries() }} />
    </div>
  )
}
