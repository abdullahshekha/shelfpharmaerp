'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'

interface SalesReturn {
  id: string
  returnNumber: string
  returnDate: string
  totalAmount: number
  notes: string | null
  retailer: { name: string; area: { name: string } | null }
  items: {
    id: string; quantity: number; reason: string | null; restocked: boolean
    medicine: { name: string }; batch: { batchNumber: string } | null
  }[]
}

export default function SalesReturnsPage() {
  const [returns, setReturns]     = useState<SalesReturn[]>([])
  const [meta, setMeta]           = useState({ totalPages: 1, total: 0 })
  const [page, setPage]           = useState(1)
  const [dateRange, setDateRange] = useState<DateRange | null>(null)
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(true)

  const fetchReturns = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (dateRange?.from) params.set('from', dateRange.from)
    if (dateRange?.to)   params.set('to', dateRange.to)
    const res = await fetch(`/api/sales-returns?${params}`)
    const j = await res.json()
    setReturns(j.data ?? [])
    setMeta({ totalPages: j.meta?.totalPages ?? 1, total: j.meta?.total ?? 0 })
    setLoading(false)
  }, [page, dateRange])

  useEffect(() => { setPage(1) }, [dateRange])
  useEffect(() => { fetchReturns() }, [fetchReturns])

  // Quick client-side filter on the loaded page (customer name or return number)
  const shown = search.trim()
    ? returns.filter(r => `${r.retailer.name} ${r.returnNumber}`.toLowerCase().includes(search.trim().toLowerCase()))
    : returns

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Returns</h1>
          <p className="text-slate-500 text-sm">{meta.total} returns</p>
        </div>
        <Link href="/sales/returns/new">
          <Button size="sm" className="gap-2"><Plus size={16} /> New Return</Button>
        </Link>
      </div>

      <DateRangePicker value={dateRange} onChange={setDateRange} />
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search customer or return #…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64 h-8 text-sm"
        />
        {(search || dateRange) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500"
            onClick={() => { setSearch(''); setDateRange(null) }}>
            Clear all
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">Return #</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Items</th>
                  <th className="text-right px-4 py-3 font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b animate-pulse">
                      <td colSpan={5} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td>
                    </tr>
                  ))
                ) : shown.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-slate-400">
                      No sales returns found.{' '}
                      <Link href="/sales/returns/new" className="text-blue-500 hover:underline">Record one.</Link>
                    </td>
                  </tr>
                ) : (
                  shown.map(r => (
                    <tr key={r.id} className="border-b align-top">
                      <td className="px-4 py-3 font-mono text-xs">{r.returnNumber}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{r.retailer.name}</p>
                        {r.retailer.area && <p className="text-xs text-slate-400">{r.retailer.area.name}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{formatDate(r.returnDate)}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {r.items.map(it => (
                          <div key={it.id} className="text-xs text-slate-600">
                            {it.medicine.name} × {it.quantity}
                            <span className="text-slate-400">
                              {it.batch ? ` · batch ${it.batch.batchNumber}` : ''}{it.reason ? ` · ${it.reason}` : ''}
                            </span>
                            {!it.restocked && <Badge variant="outline" className="ml-1 text-[10px] py-0">not restocked</Badge>}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{formatPKR(r.totalAmount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
