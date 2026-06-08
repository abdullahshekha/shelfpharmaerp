'use client'

import { useState, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR } from '@/lib/utils/format'
import { Search, Plus, AlertTriangle, Clock } from 'lucide-react'
import Link from 'next/link'

const CATEGORIES = ['Tablet', 'Capsule', 'Syrup', 'Drops/Spray', 'Topical', 'Injection', 'Sachet/Powder', 'Personal Care', 'Other']

interface Medicine {
  id: string
  code: string
  name: string
  category: string | null
  tradePrice: number
  manufacturer: { name: string }
  totalStock: number
  hasNearExpiry: boolean
  minStockLevel: number
}

function StockBadge({ total, min }: { total: number; min: number }) {
  if (total === 0) return <Badge variant="destructive">Out of Stock</Badge>
  if (total <= min) return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Low: {total}</Badge>
  return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{total}</Badge>
}

export default function InventoryPage() {
  const [medicines, setMedicines] = useState<Medicine[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [lowStock, setLowStock] = useState(false)
  const [nearExpiry, setNearExpiry] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchMedicines = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '20',
      search,
      category,
      lowStock: String(lowStock),
      nearExpiry: String(nearExpiry),
    })
    const res = await fetch(`/api/inventory?${params}`)
    const json = await res.json()
    setMedicines(json.data ?? [])
    setTotal(json.meta?.total ?? 0)
    setLoading(false)
  }, [page, search, category, lowStock, nearExpiry])

  useEffect(() => { fetchMedicines() }, [fetchMedicines])

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="text-slate-500 text-sm">{total} medicines</p>
        </div>
        <Link href="/inventory/add">
          <Button size="sm" className="gap-2">
            <Plus size={16} /> Add Medicine
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search by name, code, manufacturer..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

        <Select value={category || 'all'} onValueChange={(v) => { setCategory(v === 'all' ? '' : (v ?? '')); setPage(1) }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Button
          variant={lowStock ? 'default' : 'outline'}
          size="sm"
          className="gap-1"
          onClick={() => { setLowStock(!lowStock); setPage(1) }}
        >
          <AlertTriangle size={14} /> Low Stock
        </Button>

        <Button
          variant={nearExpiry ? 'default' : 'outline'}
          size="sm"
          className="gap-1"
          onClick={() => { setNearExpiry(!nearExpiry); setPage(1) }}
        >
          <Clock size={14} /> Near Expiry
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">Code</th>
                  <th className="text-left px-4 py-3 font-medium">Medicine</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Manufacturer</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Category</th>
                  <th className="text-right px-4 py-3 font-medium">T.P.</th>
                  <th className="text-center px-4 py-3 font-medium">Stock</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b animate-pulse">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="h-4 bg-slate-100 rounded" />
                      </td>
                    </tr>
                  ))
                ) : medicines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-400">
                      No medicines found
                    </td>
                  </tr>
                ) : (
                  medicines.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => window.location.href = `/inventory/${m.id}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{m.code}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{m.name}</div>
                        {m.hasNearExpiry && (
                          <span className="text-xs text-orange-600 flex items-center gap-1 mt-0.5">
                            <Clock size={10} /> Near expiry
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell text-xs">{m.manufacturer.name}</td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {m.category && (
                          <Badge variant="outline" className="text-xs">{m.category}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{formatPKR(m.tradePrice)}</td>
                      <td className="px-4 py-3 text-center">
                        <StockBadge total={m.totalStock} min={m.minStockLevel} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
