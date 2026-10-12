'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { formatPKR } from '@/lib/utils/format'
import { downloadCsv } from '@/lib/utils/csv'

export interface ReportLine {
  label: string
  code?: string
  amount?: number
  kind?: 'head' | 'row' | 'total' | 'grand'
}

export function ReportTable({ lines, loading, empty = 'No activity.' }: { lines: ReportLine[]; loading?: boolean; empty?: string }) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <tr key={i} className="border-b animate-pulse"><td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td></tr>)
            ) : lines.length === 0 ? (
              <tr><td className="text-center py-10 text-slate-400">{empty}</td></tr>
            ) : lines.map((l, i) => {
              const k = l.kind ?? 'row'
              return (
                <tr key={i} className={`border-b ${k === 'head' ? 'bg-slate-50' : ''} ${k === 'grand' ? 'bg-slate-100' : ''}`}>
                  <td className={`px-4 py-2 ${k === 'head' ? 'font-semibold text-slate-700' : k === 'row' ? 'pl-8' : 'font-semibold'}`}>
                    {l.code && <span className="text-slate-400 mr-2 font-mono text-xs">{l.code}</span>}{l.label}
                  </td>
                  <td className={`px-4 py-2 text-right whitespace-nowrap ${k === 'row' ? '' : 'font-semibold'} ${l.amount !== undefined && l.amount < 0 ? 'text-red-600' : ''}`}>
                    {l.amount === undefined ? '' : formatPKR(l.amount)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export function ExportButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <Button variant="outline" size="sm" className="gap-2" onClick={onClick} disabled={disabled}><Download size={14} /> Export CSV</Button>
}

export function linesToCsv(filename: string, lines: ReportLine[]) {
  downloadCsv(filename, ['Code', 'Account', 'Amount'], lines.map(l => [l.code ?? '', l.label, l.amount ?? '']))
}

export function OutOfBalance({ difference }: { difference: number }) {
  return (
    <p className="text-sm font-medium text-red-700 bg-red-50 border border-red-300 rounded-md px-3 py-2">
      OUT OF BALANCE: difference of {formatPKR(difference)}. Something in the ledger does not balance; check manual journals and run a rebuild.
    </p>
  )
}

export function ReportError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm font-medium text-red-700 bg-red-50 border border-red-300 rounded-md px-3 py-2">
      Could not load this report: {message}
    </p>
  )
}

export function NoGoLiveBanner() {
  return (
    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
      No go-live date is set, so the ledger is empty and every figure is zero. Set it in Accounts settings.
    </p>
  )
}

/** Fetches `url` (null = idle) with a stale-response guard. */
export function useReport<T, M = { goLiveDate: string | null }>(url: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [meta, setMeta] = useState<M | null>(null)
  const [loading, setLoading] = useState(!!url)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(0)
  const load = useCallback(async () => {
    const id = ++reqId.current
    // Always drop the previous result first so a new URL (or an idle/null one) never shows stale figures.
    setData(null); setMeta(null); setError(null)
    if (!url) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(url)
      const j = await res.json().catch(() => ({}))
      if (id !== reqId.current) return
      if (!res.ok) { const m = j.error ?? `HTTP ${res.status}`; setError(m); toast.error(m); return }
      setData(j.data ?? null)
      setMeta(j.meta ?? null)
    } catch {
      if (id !== reqId.current) return
      setError('Network error'); toast.error('Network error loading report')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [url])
  useEffect(() => { load() }, [load])
  return { data, meta, loading, error, reload: load }
}

/** "This Month" range in Karachi time, matching the DateRangePicker preset label. */
export function thisMonthRange(): { from: string; to: string; label: string } {
  const to = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
  return { from: `${to.slice(0, 7)}-01`, to, label: 'This Month' }
}
