'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { nextDeliveryColumn, deliveryMismatch, type DeliveryColumn } from '@/lib/deliveries/columns'
import { Truck, CheckCircle, FileDown, Play, XCircle, CalendarClock, AlertTriangle, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'

interface Driver { id: string; name: string }

interface Delivery {
  id: string
  scheduledDate: string
  status: string
  notes: string | null
  driver: { id: string; name: string } | null
  order: {
    id: string
    orderNumber: string
    status: string
    totalAmount: number
    retailer: { name: string; area: { name: string } | null; address: string | null; phone: string | null }
  }
}

const COLUMNS: { key: DeliveryColumn; title: string; tone: string }[] = [
  { key: 'TO_DISPATCH', title: 'To dispatch', tone: 'border-blue-200 bg-blue-50/40' },
  { key: 'OUT', title: 'Out for delivery', tone: 'border-orange-200 bg-orange-50/40' },
  { key: 'DELIVERED', title: 'Delivered', tone: 'border-green-200 bg-green-50/40' },
]

const STATUS_COLORS: Record<string, string> = {
  FAILED: 'bg-red-100 text-red-700',
  RESCHEDULED: 'bg-yellow-100 text-yellow-700',
}

const karachiDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })

function todayRange(): DateRange {
  const s = karachiDay(new Date())
  return { from: s, to: s, label: 'Today' }
}

export default function DeliveriesPage() {
  const [dateRange, setDateRange] = useState<DateRange>(todayRange())
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDriver, setBulkDriver] = useState('none')
  const [rescheduleFor, setRescheduleFor] = useState<{ id: string; date: string } | null>(null)

  const fetchDeliveries = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
    const res = await fetch(`/api/deliveries?${params}`)
    const json = await res.json()
    setDeliveries(json.data ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [dateRange])

  useEffect(() => { fetchDeliveries() }, [fetchDeliveries])
  useEffect(() => {
    fetch('/api/employees?role=DRIVER,SALESMAN').then(r => r.json()).then(j => setDrivers(j.data ?? []))
  }, [])

  // Default to the next delivery day that has deliveries (today or later), else today.
  useEffect(() => {
    const today = karachiDay(new Date())
    fetch(`/api/deliveries?from=${today}`).then(r => r.json()).then(j => {
      const days: string[] = (j.data ?? []).map((d: Delivery) => karachiDay(d.scheduledDate)).filter((d: string) => d >= today)
      const next = days.sort()[0]
      if (next && next !== today) setDateRange({ from: next, to: next, label: formatDate(next) })
    }).catch(() => {})
  }, [])

  const act = async (id: string, body: object, okMsg = 'Updated') => {
    setUpdating(id)
    const res = await fetch(`/api/deliveries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      toast.success(okMsg)
      for (const w of j.warnings ?? []) toast.warning(w)
      fetchDeliveries()
    } else toast.error(j.error ?? 'Failed to update')
    setUpdating(null)
  }

  const assignSelected = async () => {
    if (selected.size === 0) return
    const res = await fetch('/api/deliveries/bulk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected), driverId: bulkDriver === 'none' ? null : bulkDriver }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { toast.success(`Driver set on ${j.updated} deliveries`); fetchDeliveries() }
    else toast.error(j.error ?? 'Failed to assign driver')
  }

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const byColumn = useMemo(() => {
    const m: Record<DeliveryColumn, Delivery[]> = { TO_DISPATCH: [], OUT: [], DELIVERED: [] }
    for (const d of deliveries) m[nextDeliveryColumn(d.status)].push(d)
    return m
  }, [deliveries])

  const total = deliveries.reduce((s, d) => s + Number(d.order.totalAmount), 0)
  const delivered = byColumn.DELIVERED.length

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

  const card = (d: Delivery, col: DeliveryColumn) => {
    const busy = updating === d.id
    const mismatch = deliveryMismatch(d.status, d.order.status)
    return (
      <div key={d.id} className={`rounded-lg border bg-white p-3 space-y-2 shadow-sm ${selected.has(d.id) ? 'ring-2 ring-blue-400' : ''}`}>
        <div className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 print:hidden" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{d.order.retailer.name}</div>
            <div className="text-xs text-slate-500">
              {d.order.retailer.area?.name ?? 'No area'} · <span className="font-mono">{d.order.orderNumber}</span>
            </div>
            {d.order.retailer.address && <div className="text-xs text-slate-400 truncate">{d.order.retailer.address}</div>}
          </div>
          <div className="text-sm font-semibold whitespace-nowrap">{formatPKR(d.order.totalAmount)}</div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Truck size={12} className="text-slate-400" />
          <span className={d.driver ? 'text-slate-700' : 'text-slate-400'}>{d.driver?.name ?? 'No driver'}</span>
          {STATUS_COLORS[d.status] && <Badge className={`text-[10px] ${STATUS_COLORS[d.status]}`}>{d.status}</Badge>}
        </div>

        {mismatch && (
          <div className="flex items-start gap-1.5 rounded bg-red-50 border border-red-200 p-1.5 text-xs text-red-700">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <span>Order not marked delivered ({d.order.status}); stock was not deducted.</span>
            <Button size="sm" variant="outline" className="h-6 text-[11px] ml-auto" disabled={busy}
              onClick={() => act(d.id, { action: 'deliver' }, 'Order marked delivered')}>Fix</Button>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 print:hidden">
          {col === 'TO_DISPATCH' && (
            <>
              <Button size="sm" variant="outline" className="text-xs gap-1" disabled={busy}
                onClick={() => act(d.id, { action: 'start' }, 'Out for delivery')}><Play size={12} /> Start</Button>
              <Button size="sm" variant="outline" className="text-xs gap-1" disabled={busy}
                onClick={() => setRescheduleFor({ id: d.id, date: karachiDay(new Date(Date.now() + 86400000)) })}>
                <CalendarClock size={12} /> Reschedule</Button>
              <Button size="sm" variant="outline" className="text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50" disabled={busy}
                onClick={() => act(d.id, { action: 'deliver' }, 'Delivered')}><CheckCircle size={12} /> Delivered</Button>
            </>
          )}
          {col === 'OUT' && (
            <>
              <Button size="sm" variant="outline" className="text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50" disabled={busy}
                onClick={() => act(d.id, { action: 'deliver' }, 'Delivered')}><CheckCircle size={12} /> Delivered</Button>
              <Button size="sm" variant="outline" className="text-xs gap-1 text-red-700 border-red-300 hover:bg-red-50" disabled={busy}
                onClick={() => act(d.id, { action: 'fail' }, 'Marked failed')}><XCircle size={12} /> Failed</Button>
            </>
          )}
        </div>

        {rescheduleFor?.id === d.id && (
          <div className="flex items-center gap-2 print:hidden">
            <Input type="date" className="h-7 text-xs" value={rescheduleFor.date}
              onChange={e => setRescheduleFor({ id: d.id, date: e.target.value })} />
            <Button size="sm" className="text-xs" disabled={busy}
              onClick={() => { act(d.id, { action: 'reschedule', scheduledDate: rescheduleFor.date }, 'Rescheduled'); setRescheduleFor(null) }}>Save</Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setRescheduleFor(null)}>Cancel</Button>
          </div>
        )}

        <div className="hidden print:block text-xs mt-1">Delivered: [ ] &nbsp;&nbsp; Signature: _______________</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck size={22} /> Deliveries</h1>
          <p className="text-slate-500 text-sm">
            {deliveries.length} total · {delivered} delivered · {formatPKR(total)}
          </p>
        </div>
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
      </div>

      <div className="print:hidden"><DateRangePicker value={dateRange} onChange={setDateRange} /></div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-blue-50 p-2 print:hidden">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select
            items={[{ value: 'none', label: 'No driver' }, ...drivers.map(dr => ({ value: dr.id, label: dr.name }))]}
            value={bulkDriver}
            onValueChange={v => setBulkDriver(v ?? 'none')}
          >
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Driver" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No driver</SelectItem>
              {drivers.map(dr => <SelectItem key={dr.id} value={dr.id}>{dr.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={assignSelected}>Assign driver</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold">Shelf Pharma - Delivery Manifest</h1>
        <p className="text-slate-600">
          {dateRange.from === dateRange.to ? formatDate(dateRange.from) : `${formatDate(dateRange.from)} to ${formatDate(dateRange.to)}`}
          {' '}· {deliveries.length} deliveries · Total: {formatPKR(total)}
        </p>
      </div>

      {loading ? (
        <div className="animate-pulse p-8 text-slate-400">Loading...</div>
      ) : deliveries.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-400">No deliveries for {dateRange.label}</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map(c => (
            <div key={c.key} className={`rounded-xl border p-3 space-y-3 ${c.tone}`}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">{c.title}</h2>
                <Badge variant="outline" className="text-xs">{byColumn[c.key].length}</Badge>
              </div>
              {byColumn[c.key].length === 0
                ? <p className="text-xs text-slate-400 py-4 text-center">Nothing here</p>
                : byColumn[c.key].map(d => card(d, c.key))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
