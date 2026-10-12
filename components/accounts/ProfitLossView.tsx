'use client'

import { useState } from 'react'
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker'
import { todayKarachi } from './types'
import { ReportTable, ExportButton, linesToCsv, useReport, ReportError, thisMonthRange, NoGoLiveBanner, type ReportLine } from './ReportTable'

interface Row { accountId: string; code: string; name: string; amount: number }
export interface PL {
  income: Row[]; totalIncome: number; salesReturns: Row[]; totalSalesReturns: number; netSales: number
  cogs: Row[]; totalCogs: number; grossProfit: number; expenses: Row[]; totalExpenses: number; netProfit: number
}

export function plLines(d: PL): ReportLine[] {
  const rows = (r: Row[]): ReportLine[] => r.map(x => ({ label: x.name, code: x.code, amount: x.amount }))
  return [
    { label: 'Income', kind: 'head' }, ...rows(d.income), { label: 'Total income', kind: 'total', amount: d.totalIncome },
    { label: 'Less: Sales returns', kind: 'head' }, ...rows(d.salesReturns).map(l => ({ ...l, amount: -(l.amount ?? 0) })),
    { label: 'Net sales', kind: 'total', amount: d.netSales },
    { label: 'Cost of goods sold', kind: 'head' }, ...rows(d.cogs), { label: 'Total COGS', kind: 'total', amount: d.totalCogs },
    { label: 'Gross profit', kind: 'grand', amount: d.grossProfit },
    { label: 'Expenses', kind: 'head' }, ...rows(d.expenses), { label: 'Total expenses', kind: 'total', amount: d.totalExpenses },
    { label: 'Net profit', kind: 'grand', amount: d.netProfit },
  ]
}

export function ProfitLossView({ endpoint, title }: { endpoint: string; title?: string }) {
  const [range, setRange] = useState<DateRange | null>(thisMonthRange)
  const [includeZero, setIncludeZero] = useState(false)
  const p = new URLSearchParams()
  if (range) { p.set('from', range.from); p.set('to', range.to) }
  if (includeZero) p.set('includeZero', '1')
  const { data, meta, loading, error } = useReport<PL, { goLiveDate: string | null; from: string; to: string }>(range ? `${endpoint}?${p}` : null)
  const lines = data ? plLines(data) : []

  return (
    <div className="space-y-4">
      {title && <h1 className="text-2xl font-bold">{title}</h1>}
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={includeZero} onChange={e => setIncludeZero(e.target.checked)} /> Show zero accounts</label>
        <ExportButton disabled={!data} onClick={() => linesToCsv(`profit-loss-${range?.from}-${range?.to}-${todayKarachi()}.csv`, lines)} />
      </div>
      {meta && !meta.goLiveDate && <NoGoLiveBanner />}
      {error && <ReportError message={error} />}
      <ReportTable lines={lines} loading={loading || !range} />
    </div>
  )
}
