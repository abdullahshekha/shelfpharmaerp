'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { downloadCsv } from '@/lib/utils/csv'
import { Boxes, Download } from 'lucide-react'

interface ValRow { code: string; name: string; manufacturer: string; qty: number; costValue: number; tradeValue: number }
interface StockReport {
  valuation: {
    totals: { medicines: number; qty: number; costValue: number; tradeValue: number }
    byManufacturer: { manufacturer: string; qty: number; costValue: number; tradeValue: number; items: ValRow[] }[]
  }
  lowStock: { code: string; name: string; manufacturer: string; stock: number; minStockLevel: number }[]
  expiry: {
    expiredCount: number; expiredValue: number; soonValue: number
    batches: { code: string; name: string; batchNumber: string; expiryDate: string; daysLeft: number; qty: number; costValue: number; expired: boolean }[]
  }
}

const Skeleton = () => <div className="p-4 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>
const today = () => new Date().toISOString().slice(0, 10)

export default function StockReportsPage() {
  const [data, setData] = useState<StockReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/reports/stock')
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? 'Failed to load')
        setData(j.data)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const exportValuation = () => {
    if (!data) return
    downloadCsv(`stock-valuation-${today()}.csv`,
      ['Manufacturer', 'Code', 'Medicine', 'Qty', 'Value at Cost', 'Value at Trade Price'],
      data.valuation.byManufacturer.flatMap(g => g.items.map(i => [i.manufacturer, i.code, i.name, i.qty, i.costValue.toFixed(2), i.tradeValue.toFixed(2)])))
  }

  const t = data?.valuation.totals

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes size={22} /> Stock Reports</h1>
        <Button size="sm" className="gap-2" onClick={exportValuation} disabled={!data || !data.valuation.byManufacturer.length}>
          <Download size={14} /> Export Valuation CSV
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Medicines in stock', value: t ? String(t.medicines) : '—' },
          { label: 'Units in stock', value: t ? t.qty.toLocaleString() : '—' },
          { label: 'Stock value (cost)', value: t ? formatPKR(t.costValue) : '—' },
          { label: 'Stock value (trade price)', value: t ? formatPKR(t.tradeValue) : '—' },
        ].map(c => (
          <Card key={c.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-slate-500 mb-1">{c.label}</p>
              <p className="text-lg font-bold">{loading ? '…' : c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Stock Valuation by Manufacturer</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? <Skeleton /> : !data?.valuation.byManufacturer.length ? <p className="p-4 text-sm text-slate-400">No stock on hand.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-xs text-slate-500">
                <th className="px-4 py-2 text-left">Medicine</th><th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">At Cost</th><th className="px-4 py-2 text-right">At Trade Price</th>
              </tr></thead>
              {data.valuation.byManufacturer.map(g => (
                <tbody key={g.manufacturer}>
                  <tr className="bg-slate-50 border-b font-semibold">
                    <td className="px-4 py-2">{g.manufacturer}</td>
                    <td className="px-4 py-2 text-right">{g.qty.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">{formatPKR(g.costValue)}</td>
                    <td className="px-4 py-2 text-right">{formatPKR(g.tradeValue)}</td>
                  </tr>
                  {g.items.map(i => (
                    <tr key={i.code} className="border-b">
                      <td className="px-4 py-2 pl-8"><span className="text-slate-400 mr-2">{i.code}</span>{i.name}</td>
                      <td className="px-4 py-2 text-right">{i.qty.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">{formatPKR(i.costValue)}</td>
                      <td className="px-4 py-2 text-right">{formatPKR(i.tradeValue)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot><tr className="font-bold">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right">{t?.qty.toLocaleString()}</td>
                <td className="px-4 py-2 text-right">{t && formatPKR(t.costValue)}</td>
                <td className="px-4 py-2 text-right">{t && formatPKR(t.tradeValue)}</td>
              </tr></tfoot>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Low Stock {data && `(${data.lowStock.length})`}</CardTitle>
            <Button size="sm" variant="outline" className="gap-2" disabled={!data?.lowStock.length}
              onClick={() => data && downloadCsv(`low-stock-${today()}.csv`, ['Code', 'Medicine', 'Manufacturer', 'Stock', 'Min Level'],
                data.lowStock.map(r => [r.code, r.name, r.manufacturer, r.stock, r.minStockLevel]))}>
              <Download size={14} /> CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <Skeleton /> : !data?.lowStock.length ? <p className="p-4 text-sm text-slate-400">No medicines at or below minimum stock.</p> : (
              <table className="w-full text-sm"><tbody>
                {data.lowStock.map(r => (
                  <tr key={r.code} className="border-b">
                    <td className="px-4 py-2 font-medium">{r.name}<div className="text-xs text-slate-400 font-normal">{r.manufacturer}</div></td>
                    <td className={`px-4 py-2 text-right font-medium ${r.stock === 0 ? 'text-red-600' : 'text-amber-600'}`}>{r.stock}</td>
                    <td className="px-4 py-2 text-right text-slate-500">min {r.minStockLevel}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Expired / Expiring within 90 days {data && `(${data.expiry.batches.length})`}</CardTitle>
            <Button size="sm" variant="outline" className="gap-2" disabled={!data?.expiry.batches.length}
              onClick={() => data && downloadCsv(`expiry-${today()}.csv`, ['Code', 'Medicine', 'Batch', 'Expiry', 'Days Left', 'Qty', 'Value at Cost'],
                data.expiry.batches.map(b => [b.code, b.name, b.batchNumber, b.expiryDate.slice(0, 10), b.daysLeft, b.qty, b.costValue.toFixed(2)]))}>
              <Download size={14} /> CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {data && <p className="px-4 pb-2 text-xs text-slate-500">
              Expired: {data.expiry.expiredCount} batches, {formatPKR(data.expiry.expiredValue)} at cost · Expiring soon: {formatPKR(data.expiry.soonValue)} at cost
            </p>}
            {loading ? <Skeleton /> : !data?.expiry.batches.length ? <p className="p-4 text-sm text-slate-400">No batches expired or expiring soon.</p> : (
              <table className="w-full text-sm"><tbody>
                {data.expiry.batches.map((b, idx) => (
                  <tr key={`${b.code}-${b.batchNumber}-${idx}`} className="border-b">
                    <td className="px-4 py-2 font-medium">{b.name}<div className="text-xs text-slate-400 font-normal">Batch {b.batchNumber} · {formatDate(b.expiryDate)} · {b.qty} units</div></td>
                    <td className={`px-4 py-2 text-right font-medium ${b.expired ? 'text-red-600' : 'text-amber-600'}`}>{b.expired ? `Expired ${-b.daysLeft}d ago` : `${b.daysLeft}d left`}</td>
                    <td className="px-4 py-2 text-right">{formatPKR(b.costValue)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
