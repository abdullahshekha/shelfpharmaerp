'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPKR } from '@/lib/utils/format'
import { Undo2 } from 'lucide-react'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'

interface ReturnsReport {
  totals: { returns: number; qty: number; amount: number }
  byCustomer: { name: string; returns: number; amount: number }[]
  byMedicine: { name: string; qty: number; amount: number }[]
  byReason: { reason: string; qty: number; amount: number }[]
}

export default function SaleReturnsReportPage() {
  const [range, setRange] = useState<DateRange | null>(null)
  const [data, setData] = useState<ReturnsReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (range?.from) params.set('from', range.from)
    if (range?.to) params.set('to', range.to)
    fetch(`/api/reports/sale-returns?${params}`)
      .then(r => r.json())
      .then(j => setData(j.data ?? null))
      .finally(() => setLoading(false))
  }, [range])

  const Skeleton = () => <div className="p-4 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Undo2 size={22} /> Sale Returns Report</h1>
      <DateRangePicker value={range} onChange={setRange} />

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Returns', value: data ? String(data.totals.returns) : '—' },
          { label: 'Units returned', value: data ? String(data.totals.qty) : '—' },
          { label: 'Total credited', value: data ? formatPKR(data.totals.amount) : '—' },
        ].map(c => (
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
          <CardHeader><CardTitle className="text-base">By Customer</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? <Skeleton /> : !data?.byCustomer.length ? <p className="p-4 text-sm text-slate-400">No returns in this period.</p> : (
              <table className="w-full text-sm"><tbody>
                {data.byCustomer.map(c => (
                  <tr key={c.name} className="border-b">
                    <td className="px-4 py-2 font-medium">{c.name}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{c.returns} return{c.returns !== 1 ? 's' : ''}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatPKR(c.amount)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By Medicine</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? <Skeleton /> : !data?.byMedicine.length ? <p className="p-4 text-sm text-slate-400">No returns in this period.</p> : (
              <table className="w-full text-sm"><tbody>
                {data.byMedicine.map(m => (
                  <tr key={m.name} className="border-b">
                    <td className="px-4 py-2 font-medium">{m.name}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{m.qty} units</td>
                    <td className="px-4 py-2 text-right font-medium">{formatPKR(m.amount)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By Reason</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? <Skeleton /> : !data?.byReason.length ? <p className="p-4 text-sm text-slate-400">No returns in this period.</p> : (
              <table className="w-full text-sm"><tbody>
                {data.byReason.map(r => (
                  <tr key={r.reason} className="border-b">
                    <td className="px-4 py-2 font-medium">{r.reason}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{r.qty} units</td>
                    <td className="px-4 py-2 text-right font-medium">{formatPKR(r.amount)}</td>
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
