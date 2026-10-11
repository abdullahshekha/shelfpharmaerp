'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { portalGetJson } from '@/components/portal/portalFetch'

interface OrderView {
  id: string; orderNumber: string; orderDate: string; status: string
  totalAmount: number; invoiceTotal: number | null; scheduledDate: string | null
  items: { medicineId: string; name: string; quantity: number; lineTotal: number }[]
}

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:    { label: 'Awaiting confirmation', cls: 'bg-amber-100 text-amber-800' },
  CONFIRMED:  { label: 'Confirmed',             cls: 'bg-blue-100 text-blue-800' },
  PICKING:    { label: 'Being prepared',        cls: 'bg-blue-100 text-blue-800' },
  DISPATCHED: { label: 'Out for delivery',      cls: 'bg-indigo-100 text-indigo-800' },
  DELIVERED:  { label: 'Delivered',             cls: 'bg-green-100 text-green-800' },
  CANCELLED:  { label: 'Cancelled',             cls: 'bg-red-100 text-red-700' },
}

export default function PortalOrdersPage() {
  const [orders, setOrders] = useState<OrderView[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const j = await portalGetJson('/api/portal/orders')
      setOrders(j.data ?? [])
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (failed) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center space-y-3">
        <p className="text-slate-600">We could not load your orders.</p>
        <button onClick={() => load()} className="rounded-lg bg-blue-600 text-white text-sm font-medium px-4 py-2">Try again</button>
      </div>
    )
  }
  if (orders === null) return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-white rounded-lg animate-pulse" />)}</div>
  if (orders.length === 0) return <div className="bg-white rounded-xl border p-8 text-center text-slate-500">You have not placed any orders yet.</div>

  return (
    <div className="space-y-3">
      {orders.map(o => {
        const st = STATUS[o.status] ?? { label: o.status, cls: 'bg-slate-100 text-slate-700' }
        const expanded = openId === o.id
        return (
          <div key={o.id} className="bg-white rounded-xl border">
            <button className="w-full text-left p-4" onClick={() => setOpenId(expanded ? null : o.id)}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-xs text-slate-500">{o.orderNumber}</p>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
              </div>
              <div className="flex items-end justify-between mt-1.5">
                <div className="text-sm text-slate-600">
                  <p>{formatDate(o.orderDate)} · {o.items.length} item{o.items.length !== 1 ? 's' : ''}</p>
                  {o.scheduledDate && o.status !== 'CANCELLED' && <p className="text-xs text-slate-500">Delivery: {formatDate(o.scheduledDate)}</p>}
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatPKR(o.invoiceTotal ?? o.totalAmount)}</p>
                  <p className="text-[11px] text-slate-400">{o.invoiceTotal !== null ? 'Invoice total' : 'Excl. tax'}</p>
                </div>
              </div>
            </button>
            {expanded && (
              <div className="border-t px-4 py-2 divide-y">
                {o.items.map(i => (
                  <div key={i.medicineId} className="flex justify-between py-1.5 text-sm">
                    <span>{i.name} <span className="text-slate-400">× {i.quantity}</span></span>
                    <span className="text-slate-600">{formatPKR(i.lineTotal)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
