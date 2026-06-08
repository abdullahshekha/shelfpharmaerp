'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'

const STATUSES = ['PENDING', 'CONFIRMED', 'PICKING', 'DISPATCHED', 'DELIVERED', 'CANCELLED']

const STATUS_COLORS: Record<string, string> = {
  PENDING:    'bg-slate-100 text-slate-700',
  CONFIRMED:  'bg-blue-100 text-blue-700',
  PICKING:    'bg-yellow-100 text-yellow-700',
  DISPATCHED: 'bg-orange-100 text-orange-700',
  DELIVERED:  'bg-green-100 text-green-700',
  CANCELLED:  'bg-red-100 text-red-700',
}

interface Order {
  id: string
  orderNumber: string
  orderDate: string
  status: string
  source: string
  totalAmount: number
  retailer: { name: string; area: { name: string } | null }
  salesRep: { name: string } | null
  _count: { items: number }
}

export default function OrdersPage() {
  const [orders, setOrders]       = useState<Order[]>([])
  const [total, setTotal]         = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage]           = useState(1)
  const [status, setStatus]       = useState('')
  const [dateRange, setDateRange] = useState<DateRange | null>(null)
  const [loading, setLoading]     = useState(true)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (status)           params.set('status',   status)
    if (dateRange?.from)  params.set('dateFrom', dateRange.from)
    if (dateRange?.to)    params.set('dateTo',   dateRange.to)
    const res  = await fetch(`/api/orders?${params}`)
    const json = await res.json()
    setOrders(json.data ?? [])
    setTotal(json.meta?.total ?? 0)
    setTotalPages(json.meta?.totalPages ?? 1)
    setLoading(false)
  }, [page, status, dateRange])

  useEffect(() => { fetchOrders() }, [fetchOrders])
  useEffect(() => { setPage(1) }, [status, dateRange])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-slate-500 text-sm">{total} orders</p>
        </div>
        <Link href="/orders/new">
          <Button size="sm" className="gap-2"><Plus size={16} /> New Order</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <DateRangePicker value={dateRange} onChange={setDateRange} />
        <div className="flex gap-3 flex-wrap">
          <Select value={status || 'all'} onValueChange={v => setStatus(v === 'all' ? '' : (v ?? ''))}>
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {(status || dateRange) && (
            <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500"
              onClick={() => { setStatus(''); setDateRange(null) }}>
              Clear all
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">Order #</th>
                  <th className="text-left px-4 py-3 font-medium">Retailer</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b animate-pulse">
                      <td colSpan={6} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td>
                    </tr>
                  ))
                ) : orders.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-slate-400">No orders found</td></tr>
                ) : (
                  orders.map(o => (
                    <tr key={o.id} className="border-b hover:bg-slate-50 cursor-pointer"
                      onClick={() => window.location.href = `/orders/${o.id}`}>
                      <td className="px-4 py-3 font-mono text-xs">{o.orderNumber}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{o.retailer.name}</div>
                        {o.retailer.area && <div className="text-xs text-slate-400">{o.retailer.area.name}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{formatDate(o.orderDate)}</td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs ${STATUS_COLORS[o.status] ?? ''}`}>{o.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{formatPKR(o.totalAmount)}</td>
                      <td className="px-4 py-3">
                        <button
                          className="text-red-400 hover:text-red-600 p-1"
                          onClick={async e => {
                            e.stopPropagation()
                            if (!confirm(`Delete order ${o.orderNumber}?`)) return
                            const res = await fetch(`/api/orders/${o.id}?hard=true`, { method: 'DELETE' })
                            if (res.ok) { toast.success('Order deleted'); fetchOrders() }
                            else toast.error('Failed to delete')
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}
