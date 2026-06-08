'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { FileText, Search, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface PurchaseInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string | null
  totalAmount: number
  status: string
  notes: string | null
  supplier: { name: string; type: string }
  _count: { items: number }
}

interface Meta { page: number; pageSize: number; total: number; totalPages: number }

const STATUS_COLORS: Record<string, string> = {
  UNPAID:  'bg-red-100 text-red-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID:    'bg-green-100 text-green-700',
}

const TYPE_LABELS: Record<string, string> = {
  OPEN_MARKET:          'Open Market',
  OFFICIAL_DISTRIBUTOR: 'Official Distributor',
}

export default function PurchaseInvoicesPage() {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [meta, setMeta] = useState<Meta>({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [page, setPage] = useState(1)

  // Load supplier list for filter dropdown
  useEffect(() => {
    fetch('/api/suppliers')
      .then(r => r.json())
      .then(j => setSuppliers(j.data ?? []))
  }, [])

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter)   params.set('status', statusFilter)
    if (supplierFilter) params.set('supplierId', supplierFilter)
    params.set('page', String(page))
    params.set('pageSize', '20')

    const res = await fetch(`/api/purchase-invoices?${params}`)
    const j = await res.json()
    setInvoices(j.data ?? [])
    setMeta(j.meta ?? { page: 1, pageSize: 20, total: 0, totalPages: 1 })
    setLoading(false)
  }, [statusFilter, supplierFilter, page])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, supplierFilter])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  // Client-side invoice number search (API doesn't filter by invoice number)
  const visible = search.trim()
    ? invoices.filter(inv =>
        inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
        inv.supplier.name.toLowerCase().includes(search.toLowerCase())
      )
    : invoices

  const totalUnpaid = invoices
    .filter(i => i.status !== 'PAID')
    .reduce((s, i) => s + Number(i.totalAmount), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={22} className="text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold">Purchase Invoices</h1>
            <p className="text-slate-500 text-sm">
              {meta.total} invoices
              {totalUnpaid > 0 && (
                <span className="text-red-600 ml-2">· Outstanding: {formatPKR(totalUnpaid)}</span>
              )}
            </p>
          </div>
        </div>
        <Link href="/suppliers">
          <Button variant="outline" size="sm" className="gap-1">
            <ExternalLink size={13} /> Suppliers
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search invoice # or supplier..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <Select value={supplierFilter || 'all'} onValueChange={v => setSupplierFilter(v === 'all' ? '' : (v ?? ''))}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All suppliers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {suppliers.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter || 'all'} onValueChange={v => setStatusFilter(v === 'all' ? '' : (v ?? ''))}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="UNPAID">Unpaid</SelectItem>
            <SelectItem value="PARTIAL">Partial</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
          </SelectContent>
        </Select>

        {(statusFilter || supplierFilter || search) && (
          <Button
            variant="ghost" size="sm" className="text-slate-500"
            onClick={() => { setSearch(''); setStatusFilter(''); setSupplierFilter('') }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <FileText size={36} className="mx-auto mb-3 text-slate-300" />
              <p className="font-medium">No purchase invoices found</p>
              <p className="text-sm mt-1">
                Create invoices from the{' '}
                <Link href="/suppliers" className="text-blue-500 hover:underline">Suppliers</Link> page.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 hidden sm:table-cell">Date</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600 hidden md:table-cell">Items</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Amount</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(inv => (
                  <tr
                    key={inv.id}
                    className="border-b hover:bg-slate-50 cursor-pointer"
                    onClick={() => window.location.href = `/purchase-invoices/${inv.id}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-mono font-medium text-xs">{inv.invoiceNumber}</p>
                      {inv.notes && <p className="text-xs text-slate-400 truncate max-w-[140px]">{inv.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{inv.supplier.name}</p>
                      <p className="text-xs text-slate-400">{TYPE_LABELS[inv.supplier.type] ?? inv.supplier.type}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                      {formatDate(inv.invoiceDate)}
                      {inv.dueDate && (
                        <p className="text-xs text-slate-400">Due: {formatDate(inv.dueDate)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600 hidden md:table-cell">
                      {inv._count.items}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {formatPKR(inv.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={`text-xs ${STATUS_COLORS[inv.status] ?? ''}`}>
                        {inv.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>
            Showing {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline" size="icon" className="h-8 w-8"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft size={15} />
            </Button>
            <Button
              variant="outline" size="icon" className="h-8 w-8"
              disabled={page >= meta.totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
