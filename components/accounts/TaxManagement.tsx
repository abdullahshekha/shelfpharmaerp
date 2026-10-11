'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'
import { formatPKR } from '@/lib/utils/format'
import { downloadCsv } from '@/lib/utils/csv'
import { todayKarachi } from './types'
import { ExportButton, useReport, thisMonthRange, NoGoLiveBanner } from './ReportTable'

interface TaxRow {
  salesTaxCollected: number; salesTaxInput: number; netSalesTax: number
  advTaxCollected: number; advTaxRecoverable: number; netAdvTax: number
}
interface Tax { months: (TaxRow & { month: string })[]; totals: TaxRow }

const COLS: [keyof TaxRow, string][] = [
  ['salesTaxCollected', 'Sales tax collected'], ['salesTaxInput', 'Sales tax input'], ['netSalesTax', 'Net sales tax payable'],
  ['advTaxCollected', 'Adv. tax collected'], ['advTaxRecoverable', 'Adv. tax recoverable'], ['netAdvTax', 'Net adv. tax'],
]

export function TaxManagement() {
  const [range, setRange] = useState<DateRange | null>(() => {
    const t = thisMonthRange()
    return { from: `${t.to.slice(0, 4)}-01-01`, to: t.to, label: 'Custom' }
  })
  const url = range ? `/api/accounts/tax?from=${range.from}&to=${range.to}` : null
  const { data, meta, loading } = useReport<Tax, { goLiveDate: string | null }>(url)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Tax Management</h1>
          <p className="text-slate-500 text-sm">Sales tax and advance tax movements by month, from the ledger</p>
        </div>
        <ExportButton disabled={!data} onClick={() => data && downloadCsv(`tax-${range?.from}-${range?.to}-${todayKarachi()}.csv`, ['Month', ...COLS.map(c => c[1])],
          [...data.months.map(m => [m.month, ...COLS.map(c => m[c[0]])]), ['Total', ...COLS.map(c => data.totals[c[0]])]])} />
      </div>
      <DateRangePicker value={range} onChange={setRange} />
      {meta && !meta.goLiveDate && <NoGoLiveBanner />}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-slate-50 text-slate-600">
                <th className="text-left px-4 py-3 font-medium">Month</th>
                {COLS.map(c => <th key={c[0]} className="text-right px-3 py-3 font-medium">{c[1]}</th>)}
              </tr></thead>
              <tbody>
                {loading ? <tr className="animate-pulse"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td></tr>
                  : !data || data.months.length === 0 ? <tr><td colSpan={7} className="text-center py-10 text-slate-400">No tax activity in this period.</td></tr>
                  : data.months.map(m => (
                    <tr key={m.month} className="border-b">
                      <td className="px-4 py-2 font-medium">{m.month}</td>
                      {COLS.map(c => <td key={c[0]} className="px-3 py-2 text-right">{formatPKR(m[c[0]])}</td>)}
                    </tr>
                  ))}
                {data && data.months.length > 0 && (
                  <tr className="bg-slate-100 font-semibold">
                    <td className="px-4 py-2">Total</td>
                    {COLS.map(c => <td key={c[0]} className="px-3 py-2 text-right">{formatPKR(data.totals[c[0]])}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-slate-500">Collected = credits to the tax payable accounts; input/recoverable = debits to the tax asset accounts. Net payable is collected minus input.</p>
    </div>
  )
}
