'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatPKR } from '@/lib/utils/format'
import { downloadCsv } from '@/lib/utils/csv'
import { ShoppingCart, Download } from 'lucide-react'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'

interface PurchaseReport {
  totals: { invoices: number; total: number; salesTax: number; aitCollectible: number; aitPayable: number }
  bySupplier: { name: string; invoices: number; amount: number }[]
  byMedicine: { name: string; qty: number; amount: number }[]
  byMonth: { month: string; invoices: number; amount: number }[]
  returns: { count: number; total: number; bySupplier: { name: string; returns: number; amount: number }[] }
}

const Skeleton = () => <div className="p-4 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>

export default function PurchaseReportsPage() {
  const [range, setRange] = useState<DateRange | null>(null)
  const [data, setData] = useState<PurchaseReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (range?.from) params.set('from', range.from)
    if (range?.to) params.set('to', range.to)
    fetch(`/api/reports/purchase?${params}`)
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? 'Failed to load')
        setData(j.data ?? null)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [range])

  const exportCsv = () => {
    if (!data) return
    downloadCsv(`purchases-by-supplier-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Supplier', 'Invoices', 'Amount'], data.bySupplier.map(s => [s.name, s.invoices, s.amount.toFixed(2)]))
  }

  const cards = data ? [
    { label: 'Invoices', value: String(data.totals.invoices) },
    { label: 'Total purchases', value: formatPKR(data.totals.total) },
    { label: 'Sales tax', value: formatPKR(data.totals.salesTax) },
    { label: 'AIT collectible', value: formatPKR(data.totals.aitCollectible) },
    { label: 'AIT payable', value: formatPKR(data.totals.aitPayable) },
  ] : ['Invoices', 'Total purchases', 'Sales tax', 'AIT collectible', 'AIT payable'].map(label => ({ label, value: '—' }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingCart size={22} /> Purchase Reports</h1>
        <Button size="sm" className="gap-2" onClick={exportCsv} disabled={!data || !data.bySupplier.length}>
          <Download size={14} /> Export CSV
        </Button>
      </div>
      <DateRangePicker value={range} onChange={setRange} />
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map(c => (
          <Card key={c.label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-slate-500 mb-1">{c.label}</p>
              <p className="text-lg font-bold">{loading ? '…' : c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">By Supplier</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? <Skeleton /> : !data?.bySupplier.length ? <p className="p-4 text-sm text-slate-400">No purchases in this period.</p> : (
              <table className="w-full text-sm"><tbody>
                {data.bySupplier.map(s => (
                  <tr key={s.name} className="border-b">
                    <td className="px-4 py-2 font-medium">{s.name}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{s.invoices} invoice{s.invoices !== 1 ? 's' : ''}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatPKR(s.amount)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By Month</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? <Skeleton /> : !data?.byMonth.length ? <p className="p-4 text-sm text-slate-400">No purchases in this period.</p> : (
              <table className="w-full text-sm"><tbody>
                {data.byMonth.map(m => (
                  <tr key={m.month} className="border-b">
                    <td className="px-4 py-2 font-medium">{m.month}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{m.invoices} invoice{m.invoices !== 1 ? 's' : ''}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatPKR(m.amount)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By Medicine</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? <Skeleton /> : !data?.byMedicine.length ? <p className="p-4 text-sm text-slate-400">No purchases in this period.</p> : (
              <table className="w-full text-sm"><tbody>
                {data.byMedicine.map(m => (
                  <tr key={m.name} className="border-b">
                    <td className="px-4 py-2 font-medium">{m.name}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{m.qty} units (incl. bonus)</td>
                    <td className="px-4 py-2 text-right font-medium">{formatPKR(m.amount)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Supplier Returns {data && `— ${data.returns.count} for ${formatPKR(data.returns.total)}`}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? <Skeleton /> : !data?.returns.bySupplier.length ? <p className="p-4 text-sm text-slate-400">No supplier returns in this period.</p> : (
              <table className="w-full text-sm"><tbody>
                {data.returns.bySupplier.map(s => (
                  <tr key={s.name} className="border-b">
                    <td className="px-4 py-2 font-medium">{s.name}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{s.returns} return{s.returns !== 1 ? 's' : ''}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatPKR(s.amount)}</td>
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
