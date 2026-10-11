'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface Customer { id: string; name: string; area?: { name: string } | null }
interface MedicineHit { id: string; name: string; code: string }
interface Batch { id: string; batchNumber: string; expiryDate: string; currentQty: number; tradePrice: number }

interface Line {
  key: number
  medicineId: string
  medicineName: string
  batches: Batch[]
  batchId: string
  quantity: string
  unitPrice: string
  restocked: boolean
  reason: string
}

const selectCls = 'h-8 rounded-md border border-input bg-background px-2 text-sm w-full'

export default function NewSalesReturnPage() {
  const router = useRouter()
  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [showCustDrop, setShowCustDrop] = useState(false)

  const [medSearch, setMedSearch] = useState('')
  const [meds, setMeds] = useState<MedicineHit[]>([])
  const [showMedDrop, setShowMedDrop] = useState(false)

  const [lines, setLines] = useState<Line[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!customerSearch || customer) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/retailers?search=${encodeURIComponent(customerSearch)}&pageSize=8`)
      const j = await res.json()
      setCustomers(j.data ?? [])
      setShowCustDrop(true)
    }, 300)
    return () => clearTimeout(t)
  }, [customerSearch, customer])

  useEffect(() => {
    if (!medSearch) { setMeds([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/inventory?search=${encodeURIComponent(medSearch)}&pageSize=8`)
      const j = await res.json()
      setMeds(j.data ?? [])
      setShowMedDrop(true)
    }, 300)
    return () => clearTimeout(t)
  }, [medSearch])

  const addLine = async (med: MedicineHit) => {
    setMedSearch('')
    setShowMedDrop(false)
    const res = await fetch(`/api/inventory/${med.id}`)
    const j = await res.json()
    const batches: Batch[] = (j.data?.batches ?? []).map((b: { id: string; batchNumber: string; expiryDate: string; currentQty: number; tradePrice: number }) => ({
      id: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, currentQty: b.currentQty, tradePrice: Number(b.tradePrice),
    }))
    if (batches.length === 0) toast.message(`${med.name} has no batches, so it can only be credited, not returned to stock`)
    setLines(prev => [...prev, {
      key: Date.now() + Math.random(),
      medicineId: med.id,
      medicineName: med.name,
      batches,
      batchId: batches[0]?.id ?? '',
      quantity: '1',
      unitPrice: batches[0] ? String(batches[0].tradePrice) : '',
      restocked: batches.length > 0,
      reason: '',
    }])
  }

  const update = (key: number, patch: Partial<Line>) =>
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))

  const changeBatch = (l: Line, batchId: string) => {
    const b = l.batches.find(x => x.id === batchId)
    update(l.key, { batchId, unitPrice: b ? String(b.tradePrice) : l.unitPrice })
  }

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0)

  const submit = async () => {
    if (!customer) { toast.error('Select a customer'); return }
    if (lines.length === 0) { toast.error('Add at least one item'); return }
    for (const l of lines) {
      const q = Number(l.quantity)
      if (!Number.isInteger(q) || q <= 0) { toast.error(`${l.medicineName}: enter a whole-number quantity`); return }
      if (l.unitPrice === '' || Number(l.unitPrice) < 0) { toast.error(`${l.medicineName}: enter a unit price`); return }
      if (l.restocked && !l.batchId) { toast.error(`${l.medicineName}: choose a batch or untick "Return to stock"`); return }
    }
    setSaving(true)
    const res = await fetch('/api/sales-returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        retailerId: customer.id,
        notes,
        items: lines.map(l => ({
          medicineId: l.medicineId,
          batchId: l.batchId || null,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          restocked: l.restocked,
          reason: l.reason,
        })),
      }),
    })
    const j = await res.json()
    setSaving(false)
    if (!res.ok) { toast.error(j.error ?? 'Failed to save return'); return }
    toast.success(`Return ${j.data.returnNumber} recorded`)
    router.push('/sales/returns')
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/sales/returns"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <h1 className="text-2xl font-bold">New Sales Return</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Customer</CardTitle></CardHeader>
        <CardContent>
          {customer ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{customer.name}</p>
                {customer.area && <p className="text-xs text-slate-400">{customer.area.name}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setCustomer(null); setCustomerSearch('') }}>Change</Button>
            </div>
          ) : (
            <div className="relative">
              <Input placeholder="Search customer…" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
              {showCustDrop && customers.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-64 overflow-auto">
                  {customers.map(c => (
                    <button key={c.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      onClick={() => { setCustomer(c); setShowCustDrop(false) }}>
                      {c.name}{c.area ? <span className="text-xs text-slate-400"> · {c.area.name}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Returned items</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {lines.map(l => (
            <div key={l.key} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{l.medicineName}</p>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500"
                  onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))}>
                  <Trash2 size={14} />
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
                <div className="col-span-2">
                  <label className="text-xs text-slate-500">Batch</label>
                  <select className={selectCls} value={l.batchId} disabled={l.batches.length === 0}
                    onChange={e => changeBatch(l, e.target.value)}>
                    {l.batches.length === 0 && <option value="">No batches</option>}
                    {l.batches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.batchNumber} · exp {formatDate(b.expiryDate)} · {b.currentQty} in stock
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Quantity</label>
                  <Input type="number" min={1} className="h-8 text-sm" value={l.quantity}
                    onChange={e => update(l.key, { quantity: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Unit price (credit)</label>
                  <Input type="number" min={0} step="0.01" className="h-8 text-sm" value={l.unitPrice}
                    onChange={e => update(l.key, { unitPrice: e.target.value })} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Input placeholder="Reason (e.g. damaged, expired, wrong item)" className="h-8 text-sm flex-1 min-w-48"
                  value={l.reason} onChange={e => update(l.key, { reason: e.target.value })} />
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={l.restocked} disabled={l.batches.length === 0}
                    onChange={e => update(l.key, { restocked: e.target.checked })} />
                  Return to stock
                </label>
                <span className="text-sm font-medium w-28 text-right">
                  {formatPKR((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}
                </span>
              </div>
            </div>
          ))}

          <div className="relative">
            <Input placeholder="Search medicine to add…" value={medSearch} onChange={e => setMedSearch(e.target.value)} />
            {showMedDrop && meds.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-64 overflow-auto">
                {meds.map(m => (
                  <button key={m.id} type="button" className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                    onClick={() => addLine(m)}>
                    {m.name} <span className="text-xs text-slate-400">{m.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <Input placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">Credited to the customer&apos;s balance</p>
            <p className="text-lg font-bold">{formatPKR(total)}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Link href="/sales/returns"><Button variant="outline">Cancel</Button></Link>
            <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Record Return'}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
