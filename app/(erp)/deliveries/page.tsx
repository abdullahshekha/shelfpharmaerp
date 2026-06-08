'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { Truck, CheckCircle, FileDown } from 'lucide-react'
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
    totalAmount: number
    retailer: { name: string; area: { name: string } | null; address: string | null; phone: string | null }
  }
}

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED:        'bg-blue-100 text-blue-700',
  OUT_FOR_DELIVERY: 'bg-orange-100 text-orange-700',
  DELIVERED:        'bg-green-100 text-green-700',
  FAILED:           'bg-red-100 text-red-700',
  RESCHEDULED:      'bg-yellow-100 text-yellow-700',
}

function todayRange(): DateRange {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  const s = d.toISOString().slice(0, 10)
  return { from: s, to: s, label: 'Today' }
}

export default function DeliveriesPage() {
  const [dateRange, setDateRange] = useState<DateRange>(todayRange())
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [drivers, setDrivers]       = useState<Driver[]>([])
  const [loading, setLoading]       = useState(true)
  const [updating, setUpdating]     = useState<string | null>(null)
  const [driverMap, setDriverMap]   = useState<Record<string, string>>({})

  const fetchDeliveries = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
    const res  = await fetch(`/api/deliveries?${params}`)
    const json = await res.json()
    const data: Delivery[] = json.data ?? []
    setDeliveries(data)
    setDriverMap(prev => {
      const next = { ...prev }
      for (const d of data) next[d.id] = d.driver?.id ?? 'none'
      return next
    })
    setLoading(false)
  }, [dateRange])

  useEffect(() => { fetchDeliveries() }, [fetchDeliveries])
  useEffect(() => {
    fetch('/api/employees?role=DRIVER').then(r => r.json()).then(j => setDrivers(j.data ?? []))
  }, [])

  const updateDelivery = async (id: string, patch: object) => {
    setUpdating(id)
    const res = await fetch(`/api/deliveries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) { toast.success('Updated'); fetchDeliveries() }
    else toast.error('Failed to update')
    setUpdating(null)
  }

  const grouped = deliveries.reduce<Record<string, Delivery[]>>((acc, d) => {
    const area = d.order.retailer.area?.name ?? 'Unassigned'
    if (!acc[area]) acc[area] = []
    acc[area].push(d)
    return acc
  }, {})

  const total     = deliveries.reduce((s, d) => s + Number(d.order.totalAmount), 0)
  const delivered = deliveries.filter(d => d.status === 'DELIVERED').length

  const pdfUrl = `/api/deliveries/print?from=${dateRange.from}&to=${dateRange.to}`

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck size={22} /> Deliveries</h1>
          <p className="text-slate-500 text-sm">
            {deliveries.length} total · {delivered} delivered · {formatPKR(total)}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={pdfUrl} download
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent">
            <FileDown size={14} /> Area-wise PDF
          </a>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            Print Manifest
          </Button>
        </div>
      </div>

      {/* Date range picker */}
      <div className="print:hidden">
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* Print header */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold">Shelf Pharma — Delivery Manifest</h1>
        <p className="text-slate-600">
          {dateRange.from === dateRange.to
            ? formatDate(dateRange.from)
            : `${formatDate(dateRange.from)} → ${formatDate(dateRange.to)}`}
          {' '}· {deliveries.length} deliveries · Total: {formatPKR(total)}
        </p>
      </div>

      {loading ? (
        <div className="animate-pulse p-8 text-slate-400">Loading...</div>
      ) : deliveries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-400">
            No deliveries for {dateRange.label}
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([area, areaDeliveries]) => (
          <Card key={area}>
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center gap-2">
                📍 {area}
                <Badge variant="outline" className="text-xs">{areaDeliveries.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="print:table-header-group">
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Retailer</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600 hidden sm:table-cell">Order #</th>
                    <th className="text-right px-4 py-2 font-medium text-slate-600 hidden sm:table-cell">Amount</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600 print:hidden">Driver</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600 print:hidden">Status</th>
                    <th className="px-4 py-2 print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  {areaDeliveries.map(d => (
                    <tr key={d.id} className={`border-b ${d.status === 'DELIVERED' ? 'bg-green-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{d.order.retailer.name}</div>
                        {d.order.retailer.phone   && <div className="text-xs text-slate-400">{d.order.retailer.phone}</div>}
                        {d.order.retailer.address && <div className="text-xs text-slate-400">{d.order.retailer.address}</div>}
                        <div className="hidden print:block text-xs mt-1">
                          □ Delivered &nbsp;&nbsp; Signature: _______________
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs hidden sm:table-cell">{d.order.orderNumber}</td>
                      <td className="px-4 py-3 text-right font-medium hidden sm:table-cell">{formatPKR(d.order.totalAmount)}</td>

                      <td className="px-4 py-3 print:hidden w-44">
                        <Select
                          value={driverMap[d.id] ?? 'none'}
                          onValueChange={v => {
                            const val = v ?? 'none'
                            setDriverMap(prev => ({ ...prev, [d.id]: val }))
                            updateDelivery(d.id, { driverId: val === 'none' ? null : val })
                          }}
                          disabled={updating === d.id}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Assign driver" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No driver</SelectItem>
                            {drivers.map(dr => <SelectItem key={dr.id} value={dr.id}>{dr.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>

                      <td className="px-4 py-3 print:hidden">
                        <Badge className={`text-xs ${STATUS_COLORS[d.status] ?? ''}`}>
                          {d.status.replace('_', ' ')}
                        </Badge>
                      </td>

                      <td className="px-4 py-3 print:hidden">
                        {d.status !== 'DELIVERED' && (
                          <Button size="sm" variant="outline"
                            className="text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50"
                            disabled={updating === d.id}
                            onClick={() => updateDelivery(d.id, { status: 'DELIVERED' })}>
                            <CheckCircle size={12} /> Delivered
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
