'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { boardColumn } from '@/lib/orders/status'
import { cardActions } from '@/lib/deliveries/ui-helpers'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { Truck, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { DeliveryCard } from '@/components/deliveries/DeliveryCard'
import { OutcomeDialog } from '@/components/deliveries/OutcomeDialog'
import type { BoardDelivery } from '@/components/deliveries/types'

const karachiDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })

// The logged-in person's own work: deliveries assigned to them and not yet resolved, plus their held deliveries
// that are due today. The API already scopes non-managers to their own deliveries; the filter below also covers
// a manager/admin who opens this page.
export default function MyDeliveriesPage() {
  const { user } = useCurrentUser()
  const role = user?.role ?? ''
  const userId = user?.id ?? ''
  const [deliveries, setDeliveries] = useState<BoardDelivery[]>([])
  const [loading, setLoading] = useState(true)
  const [outcomeFor, setOutcomeFor] = useState<BoardDelivery | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/deliveries?orderStatus=OUT_FOR_DELIVERY,ON_HOLD')
      const j = await res.json()
      setDeliveries(j.data ?? [])
    } catch {
      toast.error('Could not load your deliveries')
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const mine = useMemo(() => {
    const today = karachiDay(new Date())
    const now = new Date()
    return deliveries
      .filter(d => d.driverId === userId)
      .filter(d => d.order.status === 'OUT_FOR_DELIVERY' || (d.order.status === 'ON_HOLD' && karachiDay(d.scheduledDate) <= today))
      .map(d => ({ d, col: boardColumn(d.order, { scheduledDate: new Date(d.scheduledDate) }, now) }))
      .filter((x): x is { d: BoardDelivery; col: NonNullable<typeof x.col> } => x.col !== null)
  }, [deliveries, userId])

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Truck size={22} /> My Deliveries</h1>
          <p className="text-slate-500 text-sm">{mine.length} to deliver</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="animate-pulse p-8 text-slate-400">Loading...</div>
      ) : mine.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-400">Nothing assigned to you right now</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {mine.map(({ d, col }) => (
            <DeliveryCard key={d.id} delivery={d} column={col}
              actions={cardActions(role, userId, { driverId: d.driverId }, col)}
              onAction={a => { if (a === 'outcome') setOutcomeFor(d) }} />
          ))}
        </div>
      )}

      <OutcomeDialog delivery={outcomeFor} onClose={() => setOutcomeFor(null)} onDone={() => { setOutcomeFor(null); load() }} />
    </div>
  )
}
