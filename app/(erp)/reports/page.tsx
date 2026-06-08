'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatPKR } from '@/lib/utils/format'
import { BarChart3, RefreshCw } from 'lucide-react'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

type Tab = 'aging' | 'sales'

interface AgingData {
  totals: { current: number; days30: number; days60: number; days90: number; over90: number }
  retailers: {
    retailerId: string; retailerName: string; area: string | null
    current: number; days30: number; days60: number; days90: number; over90: number; total: number
  }[]
}

interface SalesData {
  monthlySales: { month: string; orders: number; revenue: number }[]
  topRetailers: { name: string; revenue: number }[]
  topMedicines: { name: string; qty: number; revenue: number }[]
  salesReps: { name: string; orders: number; revenue: number }[]
}

const AGING_BUCKETS = [
  { key: 'current', label: 'Current', color: 'text-slate-700', bg: 'bg-slate-100' },
  { key: 'days30', label: '1–30 Days', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  { key: 'days60', label: '31–60 Days', color: 'text-orange-700', bg: 'bg-orange-100' },
  { key: 'days90', label: '61–90 Days', color: 'text-red-600', bg: 'bg-red-100' },
  { key: 'over90', label: '90+ Days', color: 'text-red-900', bg: 'bg-red-200' },
] as const

export default function ReportsPage() {
  const [tab, setTab]           = useState<Tab>('aging')
  const [aging, setAging]       = useState<AgingData | null>(null)
  const [sales, setSales]       = useState<SalesData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [salesRange, setSalesRange] = useState<DateRange | null>(null)

  const fetchAging = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/reports/aging')
    if (res.ok) setAging((await res.json()).data)
    setLoading(false)
  }, [])

  const fetchSales = useCallback(async (range?: DateRange | null) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (range?.from) params.set('from', range.from)
    if (range?.to)   params.set('to',   range.to)
    const res = await fetch(`/api/reports/sales?${params}`)
    if (res.ok) setSales((await res.json()).data)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (tab === 'aging' && !aging) fetchAging()
    if (tab === 'sales' && !sales) fetchSales(salesRange)
  }, [tab, aging, sales, fetchAging, fetchSales, salesRange])

  useEffect(() => {
    if (tab === 'sales') { setSales(null); fetchSales(salesRange) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesRange])

  const refresh = async () => {
    setRefreshing(true)
    if (tab === 'aging') { setAging(null); await fetchAging() }
    else { setSales(null); await fetchSales(salesRange) }
    setRefreshing(false)
  }

  const grandTotal = aging ? Object.values(aging.totals).reduce((s, v) => s + v, 0) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 size={22} /> Reports</h1>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 border-b pb-0">
        {(['aging', 'sales'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'aging' ? 'Invoice Aging' : 'Sales Analytics'}
          </button>
        ))}
      </div>

      {/* Sales date filter — only shown on sales tab */}
      {tab === 'sales' && (
        <DateRangePicker value={salesRange} onChange={setSalesRange} />
      )}

      {/* AGING TAB */}
      {tab === 'aging' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {AGING_BUCKETS.map(b => (
              <Card key={b.key}>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-slate-500 mb-1">{b.label}</p>
                  {loading
                    ? <div className="h-6 bg-slate-100 rounded animate-pulse" />
                    : <p className={`text-base font-bold ${b.color}`}>{formatPKR(aging?.totals[b.key] ?? 0)}</p>
                  }
                </CardContent>
              </Card>
            ))}
          </div>
          {!loading && aging && (
            <div className="flex justify-end">
              <div className="text-right">
                <p className="text-sm text-slate-500">Total Outstanding</p>
                <p className="text-2xl font-bold text-red-700">{formatPKR(grandTotal)}</p>
              </div>
            </div>
          )}
          <Card>
            <CardHeader><CardTitle className="text-base">By Retailer</CardTitle></CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
              ) : !aging?.retailers.length ? (
                <p className="p-6 text-slate-400 text-sm">No outstanding invoices.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50">
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Retailer</th>
                        {AGING_BUCKETS.map(b => (
                          <th key={b.key} className="text-right px-3 py-3 font-medium text-slate-600 hidden sm:table-cell">{b.label}</th>
                        ))}
                        <th className="text-right px-4 py-3 font-medium text-slate-600">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aging.retailers.map(r => (
                        <tr key={r.retailerId} className="border-b hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-medium">{r.retailerName}</div>
                            {r.area && <div className="text-xs text-slate-400">{r.area}</div>}
                          </td>
                          {AGING_BUCKETS.map(b => (
                            <td key={b.key} className="px-3 py-3 text-right hidden sm:table-cell">
                              {r[b.key] > 0
                                ? <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${b.bg} ${b.color}`}>{formatPKR(r[b.key])}</span>
                                : <span className="text-slate-300">—</span>
                              }
                            </td>
                          ))}
                          <td className="px-4 py-3 text-right font-bold">{formatPKR(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-slate-50 font-semibold">
                        <td className="px-4 py-3">Total</td>
                        {AGING_BUCKETS.map(b => (
                          <td key={b.key} className="px-3 py-3 text-right hidden sm:table-cell">{formatPKR(aging.totals[b.key])}</td>
                        ))}
                        <td className="px-4 py-3 text-right text-red-700">{formatPKR(grandTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* SALES TAB */}
      {tab === 'sales' && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Monthly Revenue — Last 6 Months</CardTitle></CardHeader>
            <CardContent>
              {loading || !sales ? (
                <div className="h-48 bg-slate-50 rounded animate-pulse" />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={sales.monthlySales}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={v => `Rs.${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={65} />
                    <Tooltip formatter={(v) => formatPKR(Number(v))} />
                    <Bar dataKey="revenue" fill="#2563eb" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Top 10 Retailers (This Month)</CardTitle></CardHeader>
              <CardContent className="p-0">
                {loading || !sales ? (
                  <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>
                ) : !sales.topRetailers.length ? (
                  <p className="p-4 text-sm text-slate-400">No data yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {sales.topRetailers.map((r, i) => (
                        <tr key={r.name} className="border-b">
                          <td className="px-4 py-2 text-slate-400 w-8">{i + 1}</td>
                          <td className="px-4 py-2 font-medium">{r.name}</td>
                          <td className="px-4 py-2 text-right">{formatPKR(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Top 10 Medicines (This Month)</CardTitle></CardHeader>
              <CardContent className="p-0">
                {loading || !sales ? (
                  <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>
                ) : !sales.topMedicines.length ? (
                  <p className="p-4 text-sm text-slate-400">No data yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {sales.topMedicines.map((m, i) => (
                        <tr key={m.name} className="border-b">
                          <td className="px-4 py-2 text-slate-400 w-8">{i + 1}</td>
                          <td className="px-4 py-2 font-medium">{m.name}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{m.qty} strips</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Sales Rep Performance (This Month)</CardTitle></CardHeader>
              <CardContent className="p-0">
                {loading || !sales ? (
                  <div className="p-4 space-y-2">{[1,2].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>
                ) : !sales.salesReps.length ? (
                  <p className="p-4 text-sm text-slate-400">No rep orders this month.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50">
                        <th className="text-left px-4 py-2 font-medium text-slate-600">Rep</th>
                        <th className="text-right px-4 py-2 font-medium text-slate-600">Orders</th>
                        <th className="text-right px-4 py-2 font-medium text-slate-600">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.salesReps.map(r => (
                        <tr key={r.name} className="border-b">
                          <td className="px-4 py-2 font-medium">{r.name}</td>
                          <td className="px-4 py-2 text-right">{r.orders}</td>
                          <td className="px-4 py-2 text-right font-medium">{formatPKR(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
