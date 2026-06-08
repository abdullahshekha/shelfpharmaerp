'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { formatPKR } from '@/lib/utils/format'
import { ArrowLeft, Search, Trash2, X, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface Medicine {
  id: string
  code: string
  name: string
  tradePrice: number
  category: string | null
  totalStock: number
}

interface Retailer {
  id: string
  name: string
  creditLimit: number
  outstandingBalance?: number
  creditDays?: number
}

interface OrderLine {
  medicine: Medicine
  quantity: number
  unitPrice: number
  offerPercent: number
}

function NewOrderForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedRetailerId = searchParams.get('retailerId')

  const [retailerSearch, setRetailerSearch] = useState('')
  const [retailers, setRetailers] = useState<Retailer[]>([])
  const [selectedRetailer, setSelectedRetailer] = useState<Retailer | null>(null)
  const [showRetailerDropdown, setShowRetailerDropdown] = useState(false)

  const [medSearch, setMedSearch] = useState('')
  const [medicines, setMedicines] = useState<Medicine[]>([])
  const [showMedDropdown, setShowMedDropdown] = useState(false)

  const [lines, setLines] = useState<OrderLine[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Load preselected retailer
  useEffect(() => {
    if (preselectedRetailerId) {
      fetch(`/api/retailers/${preselectedRetailerId}`)
        .then(r => r.json())
        .then(j => j.data && setSelectedRetailer({
          id: j.data.id, name: j.data.name,
          creditLimit: j.data.creditLimit,
          outstandingBalance: Number(j.data.outstandingBalance ?? 0),
          creditDays: j.data.creditDays,
        }))
    }
  }, [preselectedRetailerId])

  // Search retailers
  useEffect(() => {
    if (!retailerSearch || selectedRetailer) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/retailers?search=${encodeURIComponent(retailerSearch)}&pageSize=8`)
      const j = await res.json()
      setRetailers(j.data ?? [])
      setShowRetailerDropdown(true)
    }, 300)
    return () => clearTimeout(t)
  }, [retailerSearch, selectedRetailer])

  // Search medicines
  useEffect(() => {
    if (!medSearch) { setMedicines([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/inventory?search=${encodeURIComponent(medSearch)}&pageSize=8`)
      const j = await res.json()
      setMedicines(j.data ?? [])
      setShowMedDropdown(true)
    }, 300)
    return () => clearTimeout(t)
  }, [medSearch])

  const addLine = (med: Medicine) => {
    if (med.totalStock === 0) {
      toast.error(`${med.name} is out of stock and cannot be added.`)
      return
    }
    const existing = lines.find(l => l.medicine.id === med.id)
    if (existing) {
      setLines(ls => ls.map(l => l.medicine.id === med.id ? { ...l, quantity: l.quantity + 1 } : l))
    } else {
      setLines(ls => [...ls, { medicine: med, quantity: 1, unitPrice: med.tradePrice, offerPercent: 0 }])
    }
    setMedSearch('')
    setShowMedDropdown(false)
  }

  const removeLine = (id: string) => setLines(ls => ls.filter(l => l.medicine.id !== id))

  const updateLine = (id: string, field: keyof OrderLine, value: number) => {
    setLines(ls => ls.map(l => l.medicine.id === id ? { ...l, [field]: value } : l))
  }

  const totalAmount = lines.reduce((sum, l) => {
    return sum + l.quantity * l.unitPrice * (1 - l.offerPercent / 100)
  }, 0)

  const handleSubmit = async () => {
    if (!selectedRetailer) { toast.error('Select a retailer'); return }
    if (lines.length === 0) { toast.error('Add at least one medicine'); return }

    // Credit limit check
    if (selectedRetailer.creditLimit > 0 && selectedRetailer.outstandingBalance !== undefined) {
      const projected = selectedRetailer.outstandingBalance + totalAmount
      if (projected > selectedRetailer.creditLimit) {
        const proceed = confirm(
          `This order will exceed ${selectedRetailer.name}'s credit limit.\n\n` +
          `Outstanding: ${selectedRetailer.outstandingBalance.toLocaleString('en-PK', { minimumFractionDigits: 2 })}\n` +
          `This order: ${totalAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}\n` +
          `Projected total: ${projected.toLocaleString('en-PK', { minimumFractionDigits: 2 })}\n` +
          `Credit limit: ${selectedRetailer.creditLimit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}\n\n` +
          `Proceed anyway?`
        )
        if (!proceed) return
      }
    }

    setSaving(true)
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        retailerId: selectedRetailer.id,
        notes,
        items: lines.map(l => ({
          medicineId: l.medicine.id,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          offerPercent: l.offerPercent,
        })),
      }),
    })

    if (res.ok) {
      const j = await res.json()
      toast.success('Order created')
      router.push(`/orders/${j.data.id}`)
    } else {
      toast.error('Failed to create order')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/orders"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <h1 className="text-2xl font-bold">New Order</h1>
      </div>

      {/* Retailer Selection */}
      <Card className="overflow-visible">
        <CardHeader><CardTitle className="text-base">1. Select Retailer</CardTitle></CardHeader>
        <CardContent>
          {selectedRetailer ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <div>
                  <p className="font-medium">{selectedRetailer.name}</p>
                  <p className="text-xs text-slate-500">
                    Credit Limit: {formatPKR(selectedRetailer.creditLimit)}
                    {selectedRetailer.outstandingBalance !== undefined && ` · Outstanding: ${formatPKR(selectedRetailer.outstandingBalance)}`}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedRetailer(null)}>
                  <X size={16} />
                </Button>
              </div>
              {selectedRetailer.creditLimit > 0 && selectedRetailer.outstandingBalance !== undefined && (() => {
                const outstanding = selectedRetailer.outstandingBalance
                const limit = selectedRetailer.creditLimit
                const projectedTotal = outstanding + totalAmount
                const utilizationPct = Math.round((outstanding / limit) * 100)
                const wouldExceed = projectedTotal > limit

                if (outstanding >= limit) {
                  return (
                    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
                      <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-red-700">
                        <strong>Credit limit fully utilized ({utilizationPct}%).</strong> Outstanding {formatPKR(outstanding)} has reached
                        the {formatPKR(limit)} limit. This order will exceed the credit limit.
                      </p>
                    </div>
                  )
                }
                if (wouldExceed) {
                  return (
                    <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm">
                      <AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
                      <p className="text-orange-700">
                        <strong>This order will exceed the credit limit.</strong> Outstanding {formatPKR(outstanding)} + order {formatPKR(totalAmount)} = {formatPKR(projectedTotal)},
                        exceeds the {formatPKR(limit)} limit.
                      </p>
                    </div>
                  )
                }
                if (utilizationPct >= 80) {
                  return (
                    <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
                      <AlertTriangle size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                      <p className="text-yellow-700">
                        <strong>Credit limit {utilizationPct}% utilized.</strong> Outstanding {formatPKR(outstanding)} of {formatPKR(limit)} limit.
                      </p>
                    </div>
                  )
                }
                return null
              })()}
            </div>
          ) : (
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search retailer by name or phone..."
                className="pl-9"
                value={retailerSearch}
                onChange={e => setRetailerSearch(e.target.value)}
                onFocus={() => retailers.length > 0 && setShowRetailerDropdown(true)}
                onBlur={() => setTimeout(() => setShowRetailerDropdown(false), 200)}
              />
              {showRetailerDropdown && retailers.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg">
                  {retailers.map(r => (
                    <button key={r.id} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm"
                      onMouseDown={async () => {
                        setRetailerSearch('')
                        setShowRetailerDropdown(false)
                        // Fetch full retailer detail to get outstanding balance
                        const res = await fetch(`/api/retailers/${r.id}`)
                        const j = await res.json()
                        setSelectedRetailer({
                          id: j.data.id, name: j.data.name,
                          creditLimit: j.data.creditLimit,
                          outstandingBalance: Number(j.data.outstandingBalance ?? 0),
                          creditDays: j.data.creditDays,
                        })
                      }}>
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Medicine Selection */}
      <Card className="overflow-visible">
        <CardHeader><CardTitle className="text-base">2. Add Medicines</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search medicine by name or code..."
              className="pl-9"
              value={medSearch}
              onChange={e => setMedSearch(e.target.value)}
              onBlur={() => setTimeout(() => setShowMedDropdown(false), 200)}
            />
            {showMedDropdown && medicines.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {medicines.map(m => (
                  <button
                    key={m.id}
                    disabled={m.totalStock === 0}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 ${
                      m.totalStock === 0
                        ? 'opacity-50 cursor-not-allowed bg-red-50'
                        : 'hover:bg-slate-50'
                    }`}
                    onMouseDown={() => addLine(m)}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{m.name}</span>
                      <span className="text-slate-400 ml-2 font-mono text-xs">{m.code}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {m.totalStock === 0
                        ? <span className="text-xs text-red-500 font-semibold">Out of Stock</span>
                        : <span className="text-xs text-green-600">{m.totalStock} in stock</span>
                      }
                      <span className="text-slate-600 font-medium">{formatPKR(m.tradePrice)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-slate-600">
                  <th className="text-left py-2 font-medium">Medicine</th>
                  <th className="text-center py-2 font-medium w-20">Qty</th>
                  <th className="text-center py-2 font-medium w-24 hidden sm:table-cell">Offer %</th>
                  <th className="text-right py-2 font-medium w-28">Line Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const lineTotal = l.quantity * l.unitPrice * (1 - l.offerPercent / 100)
                  return (
                    <tr key={l.medicine.id} className={`border-b ${l.medicine.totalStock === 0 ? 'bg-red-50' : ''}`}>
                      <td className="py-2">
                        <div className="font-medium flex items-center gap-2">
                          {l.medicine.name}
                          {l.medicine.totalStock === 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-red-600 font-normal">
                              <AlertTriangle size={11} /> No stock
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">{formatPKR(l.unitPrice)} / unit</div>
                      </td>
                      <td className="py-2 text-center">
                        <Input
                          type="number" min="1"
                          className="w-16 text-center h-8 text-sm"
                          value={l.quantity}
                          onChange={e => updateLine(l.medicine.id, 'quantity', parseInt(e.target.value) || 1)}
                        />
                      </td>
                      <td className="py-2 text-center hidden sm:table-cell">
                        <Input
                          type="number" min="0" max="100" step="0.5"
                          className="w-20 text-center h-8 text-sm"
                          value={l.offerPercent}
                          onChange={e => updateLine(l.medicine.id, 'offerPercent', parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="py-2 text-right font-medium">{formatPKR(lineTotal)}</td>
                      <td className="py-2">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLine(l.medicine.id)}>
                          <Trash2 size={13} className="text-red-400" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="pt-3 text-right font-semibold">Total:</td>
                  <td className="pt-3 text-right font-bold text-lg">{formatPKR(totalAmount)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input placeholder="Any special instructions..." value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-3">
            <Link href="/orders"><Button variant="outline">Cancel</Button></Link>
            <Button onClick={handleSubmit} disabled={saving || !selectedRetailer || lines.length === 0}>
              {saving ? 'Creating...' : 'Create Order'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function NewOrderPage() {
  return (
    <Suspense>
      <NewOrderForm />
    </Suspense>
  )
}
