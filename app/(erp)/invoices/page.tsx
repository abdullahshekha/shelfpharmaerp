'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ChevronLeft, ChevronRight, Search, FileText, Building2 } from 'lucide-react'
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
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600">
                <th className="text-left px-4 py-3 font-medium">Invoice #</th>
                <th className="text-left px-4 py-3 font-medium">Retailer</th>
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

// ─── Purchase Invoices ────────────────────────────────────────────────────────

const PURCHASE_STATUS_COLORS: Record<string, string> = {
  UNPAID:  'bg-red-100 text-red-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID:    'bg-green-100 text-green-700',
}

const SUPPLIER_TYPE_LABELS: Record<string, string> = {
  OPEN_MARKET:          'Open Market',
  OFFICIAL_DISTRIBUTOR: 'Official Distributor',
}

interface PurchaseInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string | null
  totalAmount: number
  status: string
  supplier: { name: string; type: string }
  _count: { items: number }
}

function PurchaseInvoicesTab() {
  const [invoices, setInvoices]         = useState<PurchaseInvoice[]>([])
  const [meta, setMeta]                 = useState({ page: 1, totalPages: 1, total: 0 })
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [suppliers, setSuppliers]       = useState<{ id: string; name: string }[]>([])
  const [dateRange, setDateRange]       = useState<DateRange | null>(null)
  const [page, setPage]                 = useState(1)

  useEffect(() => {
    fetch('/api/suppliers').then(r => r.json()).then(j => setSuppliers(j.data ?? []))
  }, [])

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter)    params.set('status',     statusFilter)
    if (supplierFilter)  params.set('supplierId', supplierFilter)
    if (dateRange?.from) params.set('from',       dateRange.from)
    if (dateRange?.to)   params.set('to',         dateRange.to)
    params.set('page', String(page))
    params.set('pageSize', '20')
    const res = await fetch(`/api/purchase-invoices?${params}`)
    const j   = await res.json()
    setInvoices(j.data ?? [])
    setMeta({ page: j.meta?.page ?? 1, totalPages: j.meta?.totalPages ?? 1, total: j.meta?.total ?? 0 })
    setLoading(false)
  }, [statusFilter, supplierFilter, dateRange, page])

  useEffect(() => { setPage(1) }, [statusFilter, supplierFilter, dateRange])
  useEffect(() => { fetchInvoices() }, [fetchInvoices])

  const visible = search.trim()
    ? invoices.filter(inv =>
        inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
        inv.supplier.name.toLowerCase().includes(search.toLowerCase())
      )
    : invoices

  const totalOutstanding = invoices
    .filter(i => i.status !== 'PAID')
    .reduce((s, i) => s + Number(i.totalAmount), 0)

  return (
    <div className="space-y-4">
      <DateRangePicker value={dateRange} onChange={setDateRange} />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500">
          {meta.total} invoices
          {totalOutstanding > 0 && (
            <span className="text-red-600 ml-2">· Outstanding: {formatPKR(totalOutstanding)}</span>
          )}
        </p>

        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search..."
            className="pl-8 h-8 text-sm w-44"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <Select value={supplierFilter || 'all'} onValueChange={v => setSupplierFilter(v === 'all' ? '' : (v ?? ''))}>
          <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="All suppliers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={statusFilter || 'all'} onValueChange={v => setStatusFilter(v === 'all' ? '' : (v ?? ''))}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="UNPAID">Unpaid</SelectItem>
            <SelectItem value="PARTIAL">Partial</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
          </SelectContent>
        </Select>

        {(statusFilter || supplierFilter || search || dateRange) && (
          <Button variant="ghost" size="sm" className="h-8 text-slate-500 text-xs"
            onClick={() => { setSearch(''); setStatusFilter(''); setSupplierFilter(''); setDateRange(null) }}>
            Clear
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600">
                <th className="text-left px-4 py-3 font-medium">Invoice #</th>
                <th className="text-left px-4 py-3 font-medium">Supplier</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                <th className="text-center px-4 py-3 font-medium hidden md:table-cell">Items</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b animate-pulse">
                    <td colSpan={6} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td>
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    No purchase invoices found.{' '}
                    <Link href="/suppliers" className="text-blue-500 hover:underline">Create from Suppliers.</Link>
                  </td>
                </tr>
              ) : (
                visible.map(inv => (
                  <tr key={inv.id} className="border-b hover:bg-slate-50 cursor-pointer"
                    onClick={() => window.location.href = `/purchase-invoices/${inv.id}`}>
                    <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{inv.supplier.name}</p>
                      <p className="text-xs text-slate-400">{SUPPLIER_TYPE_LABELS[inv.supplier.type] ?? inv.supplier.type}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                      {formatDate(inv.invoiceDate)}
                      {inv.dueDate && <p className="text-xs text-slate-400">Due: {formatDate(inv.dueDate)}</p>}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600 hidden md:table-cell">{inv._count.items}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-xs ${PURCHASE_STATUS_COLORS[inv.status] ?? ''}`}>{inv.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatPKR(inv.totalAmount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>Page {page} of {meta.totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={15} />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page shell ───────────────────────────────────────────────────────────────

type Tab = 'retailer' | 'purchase'

export default function InvoicesPage() {
  const [tab, setTab] = useState<Tab>('retailer')

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Invoices</h1>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        <button
          onClick={() => setTab('retailer')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'retailer'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileText size={15} />
          Retailer Invoices
        </button>
        <button
          onClick={() => setTab('purchase')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'purchase'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Building2 size={15} />
          Purchase Invoices
        </button>
      </div>

      {tab === 'retailer' ? <RetailerInvoicesTab /> : <PurchaseInvoicesTab />}
    </div>
  )
}
