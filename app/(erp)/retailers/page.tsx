'use client'

import { useState, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { Search, Plus, Phone, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import Link from 'next/link'

interface Retailer {
  id: string
  name: string
  ownerName: string | null
  phone: string | null
  area: { name: string } | null
  creditLimit: number
  isActive: boolean
  salesRep: { name: string } | null
  _count: { orders: number }
}

export default function RetailersPage() {
  const [retailers, setRetailers] = useState<Retailer[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [areaId, setAreaId] = useState('')
  const [salesRepId, setSalesRepId] = useState('')
  const [ordersSort, setOrdersSort] = useState<'asc' | 'desc' | null>(null)
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([])
  const [bookers, setBookers] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const { user } = useCurrentUser()
  const isOrderBooker = user?.role === 'SALES_REP'

  useEffect(() => {
    fetch('/api/areas').then(r => r.json()).then(j => setAreas(j.data ?? []))
  }, [])

  useEffect(() => {
    // Order Bookers only ever see their own customers, so the Booker filter is meaningless for them
    if (user && !isOrderBooker) {
      fetch('/api/employees?role=SALES_REP').then(r => r.json()).then(j => setBookers(j.data ?? []))
    }
  }, [user, isOrderBooker])

  const hasFilters = !!(search || areaId || salesRepId || ordersSort)
  const clearFilters = () => { setSearch(''); setAreaId(''); setSalesRepId(''); setOrdersSort(null); setPage(1) }
  const toggleOrdersSort = () => {
    setOrdersSort((s) => (s === null ? 'asc' : s === 'asc' ? 'desc' : null))
    setPage(1)
  }

  const fetchRetailers = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), search })
    if (areaId) params.set('areaId', areaId)
    if (salesRepId) params.set('salesRepId', salesRepId)
    if (ordersSort) params.set('sort', `orders_${ordersSort}`)
    const res = await fetch(`/api/retailers?${params}`)
    const json = await res.json()
    setRetailers(json.data ?? [])
    setTotal(json.meta?.total ?? 0)
    setLoading(false)
  }, [page, search, areaId, salesRepId, ordersSort])

  useEffect(() => { fetchRetailers() }, [fetchRetailers])

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
          <p className="text-slate-500 text-sm">{total} customers</p>
        </div>
        <div className="flex gap-2">
          <Link href="/retailers/add">
            <Button size="sm" className="gap-2"><Plus size={16} /> Add Customer</Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search by name, phone, owner..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

        <Select
          items={[{ value: 'all', label: 'All Areas' }, ...areas.map(a => ({ value: a.id, label: a.name }))]}
          value={areaId || 'all'}
          onValueChange={(v) => { setAreaId(v === 'all' ? '' : (v ?? '')); setPage(1) }}
        >
          <SelectTrigger className="w-40"><SelectValue placeholder="Area" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Areas</SelectItem>
            {areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>

        {!isOrderBooker && (
          <Select
            items={[{ value: 'all', label: 'All Order Bookers' }, ...bookers.map(b => ({ value: b.id, label: b.name }))]}
            value={salesRepId || 'all'}
            onValueChange={(v) => { setSalesRepId(v === 'all' ? '' : (v ?? '')); setPage(1) }}
          >
            <SelectTrigger className="w-48"><SelectValue placeholder="Order Booker" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Order Bookers</SelectItem>
              {bookers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {hasFilters && (
          <Button variant="ghost" size="sm" className="gap-1 text-slate-500" onClick={clearFilters}>
            <X size={14} /> Clear all filters
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Area</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">ORDER BOOKER</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">
                    <button className="inline-flex items-center gap-1 hover:text-slate-900" onClick={toggleOrdersSort}>
                      Orders
                      {ordersSort === null ? <ArrowUpDown size={12} className="text-slate-400" />
                        : ordersSort === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b animate-pulse">
                      <td colSpan={4} className="px-4 py-3">
                        <div className="h-4 bg-slate-100 rounded" />
                      </td>
                    </tr>
                  ))
                ) : retailers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-slate-400">No customers found</td>
                  </tr>
                ) : (
                  retailers.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b hover:bg-slate-50 cursor-pointer"
                      onClick={() => window.location.href = `/retailers/${r.id}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.name}</div>
                        {r.ownerName && <div className="text-xs text-slate-500">{r.ownerName}</div>}
                        {r.phone && (
                          <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                            <Phone size={10} /> {r.phone}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {r.area ? <Badge variant="outline" className="text-xs">{r.area.name}</Badge> : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell text-xs">
                        {r.salesRep?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        {r._count.orders}
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
