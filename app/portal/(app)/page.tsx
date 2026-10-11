'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Search, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { WEEKDAYS } from '@/lib/utils/area-schedule'
import { formatPKR } from '@/lib/utils/format'
import { portalGetJson } from '@/components/portal/portalFetch'

interface Me { name: string; deliveryDays: number[]; nextBooking: { day: number; cutoffHour: number; isToday: boolean } | null }
interface Item { medicineId: string; code: string; name: string; manufacturer: string; unitPrice: number; offerPercent: number; comment: string }
interface OpenOrder { id: string; orderNumber: string; items: { medicineId: string; quantity: number }[] }

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`
const unitNet = (i: Item) => i.unitPrice * (1 - i.offerPercent / 100)

export default function PortalOrderPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<Item[] | null>(null) // null = loading, [] with noList handled below
  const [noList, setNoList] = useState(false)
  const [open, setOpen] = useState<OpenOrder | null>(null)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    let m, o, ord
    try {
      ;[m, o, ord] = await Promise.all([
        portalGetJson('/api/portal/me'),
        portalGetJson('/api/portal/offer-list'),
        portalGetJson('/api/portal/order'),
      ])
    } catch {
      setLoadError(true)
      return
    }
    setLoadError(false)
    setMe(m.data ?? null)
    setNoList(!o.data)
    setItems(o.data?.items ?? [])
    const order: OpenOrder | null = ord.data ?? null
    setOpen(order)
    const savedMap: Record<string, number> = {}
    for (const l of order?.items ?? []) savedMap[l.medicineId] = l.quantity
    setSaved(savedMap)
    setQty(Object.fromEntries(Object.entries(savedMap).map(([k, v]) => [k, String(v)])))
  }, [])

  useEffect(() => { load() }, [load])

  const onList = useMemo(() => new Set((items ?? []).map(i => i.medicineId)), [items])
  const quantityOf = (id: string) => {
    const n = parseInt(qty[id] ?? '', 10)
    return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 0
  }

  const cart = useMemo(
    () => (items ?? []).filter(i => quantityOf(i.medicineId) > 0).map(i => ({ item: i, quantity: quantityOf(i.medicineId) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, qty]
  )
  const total = cart.reduce((s, c) => s + c.quantity * unitNet(c.item), 0)

  // Lines on the saved order whose item is no longer on the offer list are dropped on the next save
  const droppedCount = Object.keys(saved).filter(id => !onList.has(id)).length
  const dirty = (() => {
    const now: Record<string, number> = {}
    for (const c of cart) now[c.item.medicineId] = c.quantity
    const keys = new Set([...Object.keys(now), ...Object.keys(saved)])
    return Array.from(keys).some(k => (now[k] ?? 0) !== (saved[k] ?? 0))
  })()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (items ?? []).filter(i => !q || `${i.name} ${i.code} ${i.manufacturer}`.toLowerCase().includes(q))
  }, [items, search])

  const place = async () => {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/portal/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: open?.id ?? null, items: cart.map(c => ({ medicineId: c.item.medicineId, quantity: c.quantity })) }),
      })
      if (res.status === 401) { window.location.href = '/portal/login'; return }
      const j = await res.json().catch(() => ({}))
      if (res.status === 409) {
        toast.error(j.error ?? 'Your order changed — it has been reloaded')
        await load()
        return
      }
      if (!res.ok) { toast.error(j.error ?? 'Could not save your order'); return }
      toast.success(j.data ? (open ? 'Order updated' : 'Order placed — our team will review it shortly') : 'Order removed')
      await load()
    } catch {
      toast.error('Could not save your order — please try again')
    } finally {
      setSaving(false)
    }
  }

  if (loadError && items === null) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center space-y-3">
        <p className="text-slate-600">We could not load your offer list.</p>
        <button onClick={() => load()} className="rounded-lg bg-blue-600 text-white text-sm font-medium px-4 py-2">Try again</button>
      </div>
    )
  }
  if (items === null) return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-white rounded-lg animate-pulse" />)}</div>

  let manufacturerShown = ''

  return (
    <div className="space-y-4 pb-28">
      {/* Delivery days + booking cut-off */}
      {me && (me.deliveryDays.length > 0 || me.nextBooking) && (
        <div className="bg-white rounded-xl border p-4 space-y-2">
          {me.deliveryDays.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5"><CalendarDays size={14} /> Delivery days</p>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {me.deliveryDays.map(d => (
                  <span key={d} className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">{WEEKDAYS[d]}</span>
                ))}
              </div>
            </div>
          )}
          {me.nextBooking && (
            <p className="text-sm text-slate-600">
              Order by <strong>{me.nextBooking.isToday ? 'today' : WEEKDAYS[me.nextBooking.day]} {hourLabel(me.nextBooking.cutoffHour)}</strong> for the next booking.
            </p>
          )}
        </div>
      )}

      {open && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
          You have an open order <strong>{open.orderNumber}</strong>. Change the quantities below and tap <strong>Update Order</strong> —
          set a quantity to 0 to remove an item. It can be changed until our team confirms it.
          {droppedCount > 0 && <span className="block mt-1">{droppedCount} item(s) on it are no longer on the offer list and will be removed when you update.</span>}
        </div>
      )}

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700 flex items-center justify-between gap-3">
          <span>We could not refresh your data.</span>
          <button onClick={() => load()} className="font-medium underline">Try again</button>
        </div>
      )}

      {!noList && <p className="text-xs text-slate-500">Special offers shown as comments (Net price, Bonus, Extra %) are applied by our team when your order is confirmed.</p>}

      {noList ? (
        <div className="bg-white rounded-xl border p-8 text-center text-slate-500">No offer list is available for you right now.</div>
      ) : (
        <>
          <div className="relative sticky top-[92px] z-10">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Search medicine, code or company…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white" />
          </div>

          {filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-10">No items match your search.</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map(i => {
                const header = i.manufacturer !== manufacturerShown ? i.manufacturer : null
                manufacturerShown = i.manufacturer
                const q = quantityOf(i.medicineId)
                return (
                  <div key={i.medicineId}>
                    {header !== null && <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-3 pb-1">{header || 'Other'}</p>}
                    <div className={`bg-white rounded-lg border px-3 py-2.5 flex items-center gap-3 ${q > 0 ? 'border-blue-300 bg-blue-50/40' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-snug">{i.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          T.P. {formatPKR(i.unitPrice)}
                          {i.offerPercent > 0 && <span className="text-green-700 font-medium"> · {i.offerPercent.toFixed(1)}% off</span>}
                          {i.comment && i.comment !== '—' && <span className="text-slate-400"> · {i.comment}</span>}
                        </p>
                      </div>
                      <Input
                        type="number" inputMode="numeric" min={0} max={9999} placeholder="Qty"
                        aria-label={`Quantity for ${i.name}`}
                        className="w-20 h-9 text-center"
                        value={qty[i.medicineId] ?? ''}
                        onChange={e => setQty(p => ({ ...p, [i.medicineId]: e.target.value }))}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Floating action button */}
      {!noList && (cart.length > 0 || (open && dirty)) && (
        <div className="fixed bottom-4 inset-x-4 z-30 max-w-3xl mx-auto">
          <button
            onClick={place}
            disabled={saving || !dirty}
            className="w-full rounded-xl bg-blue-600 text-white font-semibold py-3.5 shadow-lg disabled:opacity-60 active:scale-[0.99]"
          >
            {saving ? 'Saving…' : cart.length === 0
              ? 'Remove all items'
              : `${open ? 'Update Order' : 'Place Order'} · ${cart.length} item${cart.length !== 1 ? 's' : ''} · ${formatPKR(total)}`}
          </button>
        </div>
      )}
    </div>
  )
}
