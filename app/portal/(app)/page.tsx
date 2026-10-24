'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Search, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { WEEKDAYS } from '@/lib/utils/area-schedule'
import { formatPKR } from '@/lib/utils/format'
import { portalGetJson } from '@/components/portal/portalFetch'
import { priceOfferLine, type OfferRule } from '@/lib/utils/offer-pricing'

interface Me { name: string; deliveryDays: number[]; nextBooking: { day: number; cutoffHour: number; isToday: boolean } | null }
interface Item { medicineId: string; code: string; name: string; manufacturer: string; unitPrice: number; offerPercent: number; comment: string; rule: OfferRule; salesTax: number }
interface OpenOrder { id: string; orderNumber: string; items: { medicineId: string; quantity: number }[] }

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`

export default function PortalOrderPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<Item[] | null>(null) // null = loading, [] with noList handled below
  const [noList, setNoList] = useState(false)
  const [open, setOpen] = useState<OpenOrder | null>(null)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

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
    () => (items ?? []).filter(i => quantityOf(i.medicineId) > 0).map(i => {
      const quantity = quantityOf(i.medicineId)
      // Same pricing module the server uses, so this estimate matches what the order will be saved at.
      const priced = priceOfferLine(i.rule, i.unitPrice, quantity, { salesTax: i.salesTax, applicable: i.salesTax > 0 })
      return { item: i, quantity, priced }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, qty]
  )
  const subtotal = cart.reduce((s, c) => s + c.priced.lineTotal, 0)
  const salesTaxTotal = cart.reduce((s, c) => s + c.priced.salesTaxAmount, 0)
  const total = subtotal + salesTaxTotal

  const freeFor = (id: string) => cart.find(c => c.item.medicineId === id)?.priced.bonusQty ?? 0

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

  // Enter in search jumps to the quantity of the first match; Enter in a quantity returns to search.
  const onSearchEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const first = filtered[0]
    if (!first) return
    const el = document.querySelector<HTMLInputElement>(`input[data-qty-id="${first.medicineId}"]`)
    if (el) { el.focus(); el.select() }
  }
  const onQtyEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    setSearch('')
    searchRef.current?.focus()
  }

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

      {!noList && <p className="text-xs text-slate-500">Totals are an estimate including offers (Net price, Bonus, Extra %) and sales tax; our team confirms the final invoice.</p>}

      {noList ? (
        <div className="bg-white rounded-xl border p-8 text-center text-slate-500">No offer list is available for you right now.</div>
      ) : (
        <>
          <div className="relative sticky top-[92px] z-10">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input ref={searchRef} data-grid-enter placeholder="Search medicine, code or company…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={onSearchEnter} className="pl-9 bg-white" />
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
                          {i.rule.commentType !== 'NET_PRICE' && <>T.P. {formatPKR(i.unitPrice)}</>}
                          {i.salesTax > 0 && <span className="text-amber-700 font-medium"> · ST</span>}
                          {i.offerPercent > 0 && <span className="text-green-700 font-medium"> · {i.offerPercent.toFixed(1)}% off</span>}
                          {i.comment && i.comment !== '—' && <span className="text-slate-400"> · {i.comment}</span>}
                          {freeFor(i.medicineId) > 0 && <span className="text-blue-700 font-medium"> · {freeFor(i.medicineId)} free</span>}
                        </p>
                      </div>
                      <Input
                        type="number" inputMode="numeric" min={0} max={9999} placeholder="Qty"
                        aria-label={`Quantity for ${i.name}`}
                        data-grid-enter data-qty-id={i.medicineId}
                        onKeyDown={onQtyEnter}
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
        <div className="fixed bottom-4 inset-x-4 z-30 max-w-3xl mx-auto space-y-2">
          {cart.length > 0 && (
            <div className="rounded-xl bg-white border shadow-lg px-4 py-2 text-sm space-y-0.5">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{formatPKR(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Sales tax</span><span>{formatPKR(salesTaxTotal)}</span></div>
              <div className="flex justify-between font-semibold"><span>Estimated total</span><span>{formatPKR(total)}</span></div>
            </div>
          )}
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
