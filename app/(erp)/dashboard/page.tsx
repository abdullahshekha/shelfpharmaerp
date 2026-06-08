'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPKR, formatDate } from '@/lib/utils/format'
import {
  ShoppingCart, MessageSquare, Truck,
  AlertTriangle, Clock, DollarSign, RefreshCw, Users,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

interface Stats {
  todayOrders: { count: number; total: number }
  pendingWhatsapp: number
  tomorrowDeliveries: number
  lowStock: { id: string; code: string; name: string; totalStock: number; minStockLevel: number }[]
  nearExpiryBatches: { id: string; batchNumber: string; expiryDate: string; currentQty: number; medicine: { name: string; code: string } }[]
  outstandingReceivables: number
}

interface SalesData {
  monthlySales: { month: string; orders: number; revenue: number }[]
  topRetailers: { name: string; revenue: number }[]
  topMedicines: { name: string; qty: number; revenue: number }[]
  salesReps: { name: string; orders: number; revenue: number }[]
}

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be185d', '#059669', '#b45309', '#4338ca']

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [sales, setSales] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const [statsRes, salesRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/reports/sales'),
      ])
      if (statsRes.ok) setStats((await statsRes.json()).data)
      if (salesRes.ok) setSales((await salesRes.json()).data)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const pkrFormatter = (v: number) => `Rs.${(v / 1000).toFixed(0)}k`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">ShelfPharma — PECHS Ext. Block 6, Karachi</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => fetchAll(true)} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { title: "Today's Orders", icon: ShoppingCart, color: 'text-blue-500', value: stats?.todayOrders.count, sub: stats ? formatPKR(stats.todayOrders.total) : undefined },
          { title: 'Pending WhatsApp', icon: MessageSquare, color: 'text-green-500', value: stats?.pendingWhatsapp, sub: 'Awaiting review' },
          { title: "Tomorrow's Deliveries", icon: Truck, color: 'text-orange-500', value: stats?.tomorrowDeliveries, sub: 'Scheduled' },
          { title: 'Outstanding', icon: DollarSign, color: 'text-red-500', value: stats ? formatPKR(stats.outstandingReceivables) : undefined, sub: 'Total receivables' },
          { title: 'Low Stock', icon: AlertTriangle, color: 'text-yellow-500', value: stats?.lowStock.length, sub: 'Below min level' },
          { title: 'Near Expiry', icon: Clock, color: 'text-purple-500', value: stats?.nearExpiryBatches.length, sub: 'Within 30 days' },
        ].map(({ title, icon: Icon, color, value, sub }) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">{title}</CardTitle>
              <Icon className={color} size={18} />
            </CardHeader>
            <CardContent>
              {loading
                ? <div className="h-7 w-24 bg-slate-100 rounded animate-pulse" />
                : <p className="text-2xl font-bold">{value ?? '—'}</p>
              }
              {sub && <p className="text-xs text-slate-500 mt-1">{loading ? '...' : sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monthly Sales Chart */}
      <Card>
        <CardHeader><CardTitle className="text-base">Monthly Sales — Last 6 Months</CardTitle></CardHeader>
        <CardContent>
          {loading || !sales?.monthlySales.length ? (
            <div className="h-48 bg-slate-50 rounded animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sales.monthlySales} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={pkrFormatter} tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={(v) => formatPKR(Number(v))} />
                <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top Retailers */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users size={16} className="text-blue-500" /> Top 10 Retailers (This Month)</CardTitle></CardHeader>
          <CardContent>
            {loading || !sales ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" />)}</div>
            ) : sales.topRetailers.length === 0 ? (
              <p className="text-sm text-slate-400">No orders this month yet.</p>
            ) : (
              <div className="space-y-2">
                {sales.topRetailers.map((r, i) => (
                  <div key={r.name} className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400 w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="font-medium truncate">{r.name}</span>
                        <span className="text-slate-600 text-xs">{formatPKR(r.revenue)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full">
                        <div
                          className="h-1.5 bg-blue-500 rounded-full"
                          style={{ width: `${(r.revenue / sales.topRetailers[0].revenue) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Medicines */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShoppingCart size={16} className="text-green-500" /> Top 10 Medicines (This Month)</CardTitle></CardHeader>
          <CardContent>
            {loading || !sales ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" />)}</div>
            ) : sales.topMedicines.length === 0 ? (
              <p className="text-sm text-slate-400">No orders this month yet.</p>
            ) : (
              <div className="space-y-2">
                {sales.topMedicines.map((m, i) => (
                  <div key={m.name} className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400 w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="font-medium truncate">{m.name}</span>
                        <span className="text-slate-600 text-xs">{m.qty} strips</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full">
                        <div
                          className="h-1.5 bg-green-500 rounded-full"
                          style={{ width: `${(m.qty / sales.topMedicines[0].qty) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low Stock */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle size={16} className="text-yellow-500" /> Low Stock</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" />)}</div>
            ) : !stats?.lowStock.length ? (
              <p className="text-sm text-slate-400">No low stock alerts</p>
            ) : (
              <div className="space-y-2">
                {stats.lowStock.map(m => (
                  <div key={m.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">{m.name}</span>
                      <span className="text-slate-400 ml-2 text-xs font-mono">{m.code}</span>
                    </div>
                    <Badge variant={m.totalStock === 0 ? 'destructive' : 'outline'} className="text-xs">
                      {m.totalStock === 0 ? 'Out of Stock' : `${m.totalStock} left`}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sales Rep Performance */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users size={16} className="text-purple-500" /> Sales Rep Performance (This Month)</CardTitle></CardHeader>
          <CardContent>
            {loading || !sales ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-5 bg-slate-100 rounded animate-pulse" />)}</div>
            ) : sales.salesReps.length === 0 ? (
              <p className="text-sm text-slate-400">No sales rep orders this month.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1 font-medium text-slate-600">Rep</th>
                    <th className="text-right py-1 font-medium text-slate-600">Orders</th>
                    <th className="text-right py-1 font-medium text-slate-600">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.salesReps.map(r => (
                    <tr key={r.name} className="border-b">
                      <td className="py-2 font-medium">{r.name}</td>
                      <td className="py-2 text-right text-slate-600">{r.orders}</td>
                      <td className="py-2 text-right font-medium">{formatPKR(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Near Expiry */}
      {!loading && stats && stats.nearExpiryBatches.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock size={16} className="text-purple-500" /> Near Expiry (30 days)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.nearExpiryBatches.map(b => (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{b.medicine.name}</span>
                    <span className="text-slate-400 ml-2 text-xs">Batch: {b.batchNumber}</span>
                  </div>
                  <div className="text-right">
                    <Badge variant="destructive" className="text-xs">{formatDate(b.expiryDate)}</Badge>
                    <span className="text-xs text-slate-500 ml-1">{b.currentQty} units</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
