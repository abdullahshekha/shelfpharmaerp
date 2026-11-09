'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { formatPKR, formatDateTime } from '@/lib/utils/format'

interface Person { id: string; name: string }
interface PendingCollection {
  id: string; orderNumber: string; customer: { id: string; name: string }; method: string; amount: number
  bankAccount: { id: string; code: string; name: string } | null; pictureUrl: string; collectedBy: Person | null; collectedAt: string
}
interface PendingReturn {
  id: string; returnNumber: string; orderNumber: string | null; customer: { id: string; name: string }; totalAmount: number
  recordedBy: Person | null; recordedAt: string
  items: { id: string; medicineName: string; medicineCode: string; quantity: number; reason: string | null }[]
}

// The two manager/admin acknowledgement lists. Cheques are acknowledged in PDC Management.
export function AckLists() {
  const [collections, setCollections] = useState<PendingCollection[]>([])
  const [returns, setReturns] = useState<PendingReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/delivery-acknowledgements')
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error ?? 'Could not load acknowledgements'); return }
      setCollections(j.data?.collections ?? [])
      setReturns(j.data?.returns ?? [])
    } catch {
      toast.error('Could not load acknowledgements')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const ack = async (kind: 'collections' | 'returns', id: string, message: string, success: string) => {
    if (busy || !confirm(message)) return
    setBusy(id)
    try {
      const res = await fetch(`/api/delivery-acknowledgements/${kind}/${id}`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(success)
        for (const w of (j.warnings ?? []) as string[]) toast.warning(w)
      } else {
        toast.error(j.error ?? 'Could not acknowledge')
      }
    } catch {
      toast.error('Could not acknowledge')
    } finally {
      setBusy(null)
      load()
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Delivery Acknowledgements</h1>
          <p className="text-slate-500 text-sm">Confirm money and stock that came back from deliveries</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      <p className="text-sm text-slate-600 bg-slate-50 border rounded-md px-3 py-2">
        Cheques collected on delivery are not listed here. Acknowledge them in{' '}
        <Link href="/accounts/pdc" className="text-blue-600 hover:underline">PDC Management</Link> (tick &quot;Unacknowledged only&quot;).
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Cash and bank collections ({collections.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!loading && collections.length === 0 && <p className="text-slate-400 text-sm">Nothing waiting.</p>}
          {collections.map(c => (
            <div key={c.id} className="border rounded-md p-3 flex flex-col sm:flex-row gap-3 sm:items-center">
              <a href={c.pictureUrl} target="_blank" rel="noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.pictureUrl} alt="Proof" className="h-16 w-16 rounded object-cover border" />
              </a>
              <div className="flex-1 text-sm space-y-0.5 min-w-0">
                <p className="font-mono font-medium">{c.orderNumber}</p>
                <p>{c.customer.name}</p>
                <p className="text-slate-500">
                  {c.method === 'BANK' ? `Bank${c.bankAccount ? `: ${c.bankAccount.code} ${c.bankAccount.name}` : ''}` : 'Cash'}
                  {' | '}Collected by {c.collectedBy?.name ?? 'Unknown'} on {formatDateTime(c.collectedAt)}
                </p>
              </div>
              <div className="sm:text-right space-y-2">
                <p className="font-bold text-lg">{formatPKR(c.amount)}</p>
                <Button size="sm" disabled={busy !== null}
                  onClick={() => ack('collections', c.id, `Acknowledge ${formatPKR(c.amount)} from ${c.customer.name} (${c.orderNumber})? This records a payment on the invoice.`, 'Collection acknowledged, payment recorded')}>
                  {busy === c.id ? 'Working...' : 'Acknowledge'}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Returned stock ({returns.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!loading && returns.length === 0 && <p className="text-slate-400 text-sm">Nothing waiting.</p>}
          {returns.map(r => (
            <div key={r.id} className="border rounded-md p-3 flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="flex-1 text-sm space-y-1 min-w-0">
                <p><span className="font-mono font-medium">{r.orderNumber ?? r.returnNumber}</span> <Badge variant="outline" className="text-[10px] ml-1">{r.returnNumber}</Badge></p>
                <p>{r.customer.name}</p>
                <ul className="list-disc ml-4 text-slate-600">
                  {r.items.map(i => <li key={i.id}>{i.medicineName} ({i.medicineCode}) x {i.quantity}{i.reason ? `, ${i.reason}` : ''}</li>)}
                </ul>
                <p className="text-slate-500">Recorded by {r.recordedBy?.name ?? 'Unknown'} on {formatDateTime(r.recordedAt)}</p>
              </div>
              <Button size="sm" disabled={busy !== null}
                onClick={() => ack('returns', r.id, `Confirm the returned stock for ${r.orderNumber ?? r.returnNumber} is back in the warehouse? It will be added back to stock.`, 'Returned stock acknowledged')}>
                {busy === r.id ? 'Working...' : 'Acknowledge stock received'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
