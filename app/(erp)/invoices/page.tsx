'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'

// ─── Retailer Invoices ────────────────────────────────────────────────────────

const RETAILER_STATUSES = ['DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'OVERDUE']
const RETAILER_STATUS_COLORS: Record<string, string> = {
  DRAFT:   'bg-slate-100 text-slate-700',
  UNPAID:  'bg-red-100 text-red-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID:    'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-200 text-red-800',
}

interface RetailerInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  totalAmount: number
  status: string
  retailer: { name: string; area: { name: string } | null }
  order: { orderNumber: string }
}

function RetailerInvoicesTab() {
  const [invoices, setInvoices]     = useState<RetailerInvoice[]>([])
  const [total, setTotal]           = useState(0)
  const [page, setPage]             = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [status, setStatus]         = useState('')
  const [dateRange, setDateRange]   = useState<DateRange | null>(null)
  const [loading, setLoading]       = useState(true)

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (status)          params.set('status', status)
    if (dateRange?.from) params.set('from',   dateRange.from)
    if (dateRange?.to)   params.set('to',     dateRange.to)
    const res  = await fetch(`/api/invoices?${params}`)
    const json = await res.json()
    setInvoices(json.data ?? [])
    setTotal(json.meta?.total ?? 0)
    setTotalPages(json.meta?.totalPages ?? 1)
    setLoading(false)
  }, [page, status, dateRange])

  useEffect(() => { fetchInvoices() }, [fetchInvoices])
  useEffect(() => { setPage(1) }, [status, dateRange])

  return (
    <div className="space-y-4">
      <DateRangePicker value={dateRange} onChange={setDateRange} />
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-sm text-slate-500">{total} invoices</p>
        <Select value={status || 'all'} onValueChange={v => { setStatus(v === 'all' ? '' : (v ?? '')); setPage(1) }}>
          <SelectTrigger className="w-44 h-8 text-sm">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {RETAILER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {(status || dateRange) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500"
            onClick={() => { setStatus(''); setDateRange(null) }}>Clear</Button>
        )}
        <Link href="/orders/new" className="ml-auto">
          <Button size="sm" className="gap-2"><Plus size={16} /> New Sales Invoice</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600">
                <th className="text-left px-4 py-3 font-medium">Invoice #</th>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b animate-pulse">
                    <td colSpan={5} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td>
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-slate-400">No invoices found</td></tr>
              ) : (
                invoices.map(inv => (
                  <tr key={inv.id} className="border-b hover:bg-slate-50 cursor-pointer"
                    onClick={() => window.location.href = `/invoices/${inv.id}`}>
                    <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{inv.retailer.name}</p>
                      {inv.retailer.area && <p className="text-xs text-slate-400">{inv.retailer.area.name}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{formatDate(inv.invoiceDate)}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-xs ${RETAILER_STATUS_COLORS[inv.status] ?? ''}`}>{inv.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatPKR(inv.totalAmount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={15} />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Page shell ───────────────────────────────────────────────────────────────
// Purchase invoices live under Purchase > Purchase Invoice (/purchase-invoices); this page is sales invoices only.

export default function InvoicesPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Sales Invoices</h1>
      <RetailerInvoicesTab />
    </div>
  )
}
