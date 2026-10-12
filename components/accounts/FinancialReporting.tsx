'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatPKR } from '@/lib/utils/format'
import { downloadCsv } from '@/lib/utils/csv'
import { todayKarachi } from './types'
import { ProfitLossView } from './ProfitLossView'
import { ReportTable, ExportButton, linesToCsv, useReport, ReportError, NoGoLiveBanner, OutOfBalance, type ReportLine } from './ReportTable'

type Tab = 'tb' | 'pl' | 'bs'
type Row = { accountId: string; code: string; name: string; amount: number }

interface TB {
  rows: { accountId: string; code: string; name: string; type: string; debit: number; credit: number }[]
  totalDebit: number; totalCredit: number; difference: number; balanced: boolean
}
interface BS {
  assets: Row[]; totalAssets: number; liabilities: Row[]; totalLiabilities: number; equity: Row[]
  retainedEarnings: number; totalEquity: number; totalLiabilitiesAndEquity: number; difference: number; balanced: boolean
}
type AsOfMeta = { goLiveDate: string | null; asOf: string }

function AsOfBar({ asOf, setAsOf, includeZero, setIncludeZero, children }: {
  asOf: string; setAsOf: (v: string) => void; includeZero: boolean; setIncludeZero: (v: boolean) => void; children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-slate-600">As of
        <Input type="date" aria-label="As of date" className="h-8 w-40 text-sm" value={asOf} onChange={e => setAsOf(e.target.value || todayKarachi())} />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={includeZero} onChange={e => setIncludeZero(e.target.checked)} /> Show zero accounts</label>
      {children}
    </div>
  )
}

function TrialBalanceTab() {
  const [asOf, setAsOf] = useState(todayKarachi())
  const [includeZero, setIncludeZero] = useState(false)
  const { data, meta, loading, error } = useReport<TB, AsOfMeta>(`/api/accounts/reports/trial-balance?asOf=${asOf}${includeZero ? '&includeZero=1' : ''}`)
  return (
    <div className="space-y-4">
      <AsOfBar asOf={asOf} setAsOf={setAsOf} includeZero={includeZero} setIncludeZero={setIncludeZero}>
        <ExportButton disabled={!data} onClick={() => data && downloadCsv(`trial-balance-${asOf}.csv`, ['Code', 'Account', 'Type', 'Debit', 'Credit'],
          [...data.rows.map(r => [r.code, r.name, r.type, r.debit || '', r.credit || '']), ['', 'Total', '', data.totalDebit, data.totalCredit]])} />
      </AsOfBar>
      {meta && !meta.goLiveDate && <NoGoLiveBanner />}
      {error && <ReportError message={error} />}
      {data && !data.balanced && <OutOfBalance difference={data.difference} />}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-slate-50 text-slate-600">
              <th className="text-left px-4 py-3 font-medium">Account</th>
              <th className="text-right px-4 py-3 font-medium">Debit</th>
              <th className="text-right px-4 py-3 font-medium">Credit</th>
            </tr></thead>
            <tbody>
              {loading ? <tr className="animate-pulse"><td colSpan={3} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td></tr>
                : !data || data.rows.length === 0 ? <tr><td colSpan={3} className="text-center py-10 text-slate-400">No activity.</td></tr>
                : data.rows.map(r => (
                  <tr key={r.accountId} className="border-b">
                    <td className="px-4 py-2"><span className="text-slate-400 mr-2 font-mono text-xs">{r.code}</span>{r.name}</td>
                    <td className="px-4 py-2 text-right">{r.debit ? formatPKR(r.debit) : ''}</td>
                    <td className="px-4 py-2 text-right">{r.credit ? formatPKR(r.credit) : ''}</td>
                  </tr>
                ))}
              {data && (
                <tr className="bg-slate-100 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">{formatPKR(data.totalDebit)}</td>
                  <td className="px-4 py-2 text-right">{formatPKR(data.totalCredit)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function bsLines(d: BS): ReportLine[] {
  const rows = (r: Row[]): ReportLine[] => r.map(x => ({ label: x.name, code: x.code, amount: x.amount }))
  return [
    { label: 'Assets', kind: 'head' }, ...rows(d.assets), { label: 'Total assets', kind: 'grand', amount: d.totalAssets },
    { label: 'Liabilities', kind: 'head' }, ...rows(d.liabilities), { label: 'Total liabilities', kind: 'total', amount: d.totalLiabilities },
    { label: 'Equity', kind: 'head' }, ...rows(d.equity), { label: 'Total equity', kind: 'total', amount: d.totalEquity },
    { label: 'Total liabilities and equity', kind: 'grand', amount: d.totalLiabilitiesAndEquity },
  ]
}

function BalanceSheetTab() {
  const [asOf, setAsOf] = useState(todayKarachi())
  const [includeZero, setIncludeZero] = useState(false)
  const { data, meta, loading, error } = useReport<BS, AsOfMeta>(`/api/accounts/reports/balance-sheet?asOf=${asOf}${includeZero ? '&includeZero=1' : ''}`)
  const lines = data ? bsLines(data) : []
  return (
    <div className="space-y-4">
      <AsOfBar asOf={asOf} setAsOf={setAsOf} includeZero={includeZero} setIncludeZero={setIncludeZero}>
        <ExportButton disabled={!data} onClick={() => linesToCsv(`balance-sheet-${asOf}.csv`, lines)} />
      </AsOfBar>
      {meta && !meta.goLiveDate && <NoGoLiveBanner />}
      {error && <ReportError message={error} />}
      {data && !data.balanced && <OutOfBalance difference={data.difference} />}
      <ReportTable lines={lines} loading={loading} />
      {data && data.balanced && <p className="text-xs text-slate-500">Balanced: assets equal liabilities plus equity (including cumulative net profit of {formatPKR(data.retainedEarnings)}).</p>}
    </div>
  )
}

export function FinancialReporting() {
  const [tab, setTab] = useState<Tab>('tb')
  const tabs: [Tab, string][] = [['tb', 'Trial Balance'], ['pl', 'Profit & Loss'], ['bs', 'Balance Sheet']]
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Financial Reporting</h1>
        <p className="text-slate-500 text-sm">Read-only reports computed from the general ledger</p>
      </div>
      <div className="flex gap-1 border-b">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'tb' && <TrialBalanceTab />}
      {tab === 'pl' && <ProfitLossView endpoint="/api/accounts/reports/profit-loss" />}
      {tab === 'bs' && <BalanceSheetTab />}
    </div>
  )
}
