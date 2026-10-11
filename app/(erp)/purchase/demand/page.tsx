'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR } from '@/lib/utils/format'
import { Download, RefreshCw } from 'lucide-react'

interface DemandRow {
  medicineId: string
  code: string
  name: string
  manufacturer: string | null
  stock: number
  minStockLevel: number
  pendingQty: number
  suggestedQty: number
  lastSupplierId: string | null
  lastSupplierName: string | null
  lastPurchasePrice: number | null
}

const csvCell = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`

export default function PurchaseDemandPage() {
  const [rows, setRows] = useState<DemandRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [qty, setQty] = useState<Record<string, string>>({}) // on-screen edits of the suggested qty

  useEffect(() => {
    fetch('/api/suppliers').then(r => r.json()).then(j => setSuppliers(j.data ?? []))
  }, [])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (supplierId) params.set('supplierId', supplierId)
    const res = await fetch(`/api/purchase-demand?${params}`)
    const j = await res.json()
    setRows(j.data ?? [])
    setLoading(false)
  }, [search, supplierId])

  useEffect(() => {
    const t = setTimeout(fetchRows, 300)
    return () => clearTimeout(t)
  }, [fetchRows])

  const orderQty = (r: DemandRow) => {
    const v = qty[r.medicineId]
    return v === undefined || v === '' ? r.suggestedQty : Math.max(0, parseInt(v, 10) || 0)
  }

  const totalCost = useMemo(
    () => rows.reduce((s, r) => s + orderQty(r) * (r.lastPurchasePrice ?? 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, qty]
  )

  const exportCsv = () => {
    const header = ['Supplier', 'Code', 'Medicine', 'Manufacturer', 'Stock', 'Min level', 'Pending orders', 'Order qty', 'Last price', 'Est. cost']
    const lines = rows.filter(r => orderQty(r) > 0).map(r => [
      r.lastSupplierName ?? 'No purchase history', r.code, r.name, r.manufacturer, r.stock, r.minStockLevel, r.pendingQty,
      orderQty(r), r.lastPurchasePrice, r.lastPurchasePrice !== null ? (orderQty(r) * r.lastPurchasePrice).toFixed(2) : '',
    ].map(csvCell).join(','))
    const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `purchase-demand-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  let lastGroup: string | null = null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Purchase Demand</h1>
          <p className="text-slate-500 text-sm">
            {rows.length} items to reorder · est. {formatPKR(totalCost)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={fetchRows}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button size="sm" className="gap-2" onClick={exportCsv} disabled={rows.length === 0}>
            <Download size={14} /> Export CSV
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Suggested qty = pending orders (not yet delivered) + minimum stock level − current stock. Edit a quantity to adjust it
        for the export; nothing here changes stock or creates invoices.
      </p>

      <div className="flex flex-wrap gap-3">
        <Input placeholder="Search medicine, generic, code, manufacturer…" value={search}
          onChange={e => setSearch(e.target.value)} className="w-72 h-8 text-sm" />
        <Select
          items={[{ value: 'all', label: 'All last suppliers' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
          value={supplierId || 'all'}
          onValueChange={v => setSupplierId(v === 'all' ? '' : (v ?? ''))}
        >
          <SelectTrigger className="w-52 h-8 text-sm"><SelectValue placeholder="All last suppliers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All last suppliers</SelectItem>
            {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {(search || supplierId) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500"
            onClick={() => { setSearch(''); setSupplierId('') }}>Clear all</Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="text-left px-4 py-3 font-medium">Medicine</th>
                  <th className="text-right px-3 py-3 font-medium">Stock</th>
                  <th className="text-right px-3 py-3 font-medium hidden sm:table-cell">Min</th>
                  <th className="text-right px-3 py-3 font-medium hidden sm:table-cell">Pending</th>
                  <th className="text-right px-3 py-3 font-medium">Order qty</th>
                  <th className="text-right px-3 py-3 font-medium hidden md:table-cell">Last price</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b animate-pulse">
                      <td colSpan={7} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-slate-400">Nothing needs reordering right now.</td></tr>
                ) : (
                  rows.flatMap(r => {
                    const group = r.lastSupplierName ?? 'No purchase history'
                    const out = []
                    if (group !== lastGroup) {
                      lastGroup = group
                      out.push(
                        <tr key={`g-${group}`} className="bg-slate-100">
                          <td colSpan={7} className="px-4 py-1.5 text-xs font-semibold text-slate-600 uppercase">{group}</td>
                        </tr>
                      )
                    }
                    out.push(
                      <tr key={r.medicineId} className="border-b">
                        <td className="px-4 py-2">
                          <p className="font-medium">{r.name}</p>
                          <p className="text-xs text-slate-400">{r.code}{r.manufacturer ? ` · ${r.manufacturer}` : ''}</p>
                        </td>
                        <td className={`px-3 py-2 text-right ${r.stock <= r.minStockLevel ? 'text-red-600 font-medium' : ''}`}>{r.stock}</td>
                        <td className="px-3 py-2 text-right text-slate-500 hidden sm:table-cell">{r.minStockLevel}</td>
                        <td className="px-3 py-2 text-right text-slate-500 hidden sm:table-cell">{r.pendingQty}</td>
                        <td className="px-3 py-2 text-right">
                          <Input type="number" min={0} className="h-7 w-20 text-sm text-right ml-auto"
                            value={qty[r.medicineId] ?? String(r.suggestedQty)}
                            onChange={e => setQty(prev => ({ ...prev, [r.medicineId]: e.target.value }))} />
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600 hidden md:table-cell">
                          {r.lastPurchasePrice !== null ? formatPKR(r.lastPurchasePrice) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-medium hidden md:table-cell">
                          {r.lastPurchasePrice !== null ? formatPKR(orderQty(r) * r.lastPurchasePrice) : '—'}
                        </td>
                      </tr>
                    )
                    return out
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
