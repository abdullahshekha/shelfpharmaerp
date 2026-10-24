'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { formatPKR } from '@/lib/utils/format'
import { priceOfferLine, resolveSalesTax, type OfferRule } from '@/lib/utils/offer-pricing'
import { formatOfferComment } from '@/lib/utils/offer-comment'
import { ArrowLeft, Search, Trash2, X, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface Medicine {
  id: string
  code: string
  name: string
  tradePrice: number | null
  mrp: number | null
  salesTaxApplicable: boolean
  category: string | null
  totalStock: number
}

interface Customer {
  id: string
  name: string
  creditLimit: number
  outstandingBalance?: number
  creditDays?: number
}

interface OfferListItem {
  medicineId: string
  offerPercent: number
  specialPrice: number | null
  salesTax: number
  commentType?: string
  commentNetPrice?: number | string | null
  commentMinOrderQty?: number | null
  commentQtyFree?: number | null
  commentExtraPercent?: number | string | null
  fefoSalesTax?: number | null
}

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v))

const NO_RULE: OfferRule = {
  commentType: 'NONE', offerPercent: 0, commentNetPrice: null,
  commentMinOrderQty: null, commentQtyFree: null, commentExtraPercent: null,
}

function ruleFor(offer: OfferListItem | undefined): OfferRule {
  if (!offer) return NO_RULE
  return {
    commentType: offer.commentType ?? 'NONE',
    offerPercent: Number(offer.offerPercent),
    commentNetPrice: num(offer.commentNetPrice),
    commentMinOrderQty: offer.commentMinOrderQty ?? null,
    commentQtyFree: offer.commentQtyFree ?? null,
    commentExtraPercent: num(offer.commentExtraPercent),
  }
}

interface OrderLine {
  medicine: Medicine
  quantity: number
  mrp: number | null
  unitPrice: number
  offerPercent: number
  salesTax: number
  bonusQty: number
  rule: OfferRule
  basePrice: number
}

function lineUnitTotal(l: OrderLine) {
  const discounted = l.unitPrice * (1 - l.offerPercent / 100)
  const salesTax = l.medicine.salesTaxApplicable ? l.salesTax : 0
  return discounted + salesTax
}

function NewOrderForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedRetailerId = searchParams.get('retailerId')
  const draftId = searchParams.get('draft')
  const draftLoaded = useRef(false)
  const [offersReady, setOffersReady] = useState(false)

  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)

  const [medSearch, setMedSearch] = useState('')
  const [medicines, setMedicines] = useState<Medicine[]>([])
  const [showMedDropdown, setShowMedDropdown] = useState(false)

  const [offerItems, setOfferItems] = useState<Map<string, OfferListItem>>(new Map())
  const [lines, setLines] = useState<OrderLine[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Load the active offer list's items so new lines can auto-fill Trade Price/Discount %/Sales Tax.
  useEffect(() => {
    fetch('/api/offer-list/active').then(r => r.json()).then(j => {
      const items: OfferListItem[] = j.data?.items ?? []
      setOfferItems(new Map(items.map(i => [i.medicineId, i])))
    }).finally(() => setOffersReady(true))
  }, [])

  // Reopen a saved draft: restore customer, notes and lines exactly as saved (stored prices stick).
  useEffect(() => {
    if (!draftId || !offersReady || draftLoaded.current) return
    draftLoaded.current = true
    fetch(`/api/orders/${draftId}`).then(r => r.json()).then(async j => {
      const o = j.data
      if (!o || o.status !== 'DRAFT') { toast.error('This draft is no longer editable'); return }
      const cRes = await fetch(`/api/retailers/${o.retailerId}`).then(r => r.json())
      setSelectedCustomer({
        id: cRes.data.id, name: cRes.data.name, creditLimit: cRes.data.creditLimit,
        outstandingBalance: Number(cRes.data.outstandingBalance ?? 0), creditDays: cRes.data.creditDays,
      })
      setNotes(o.notes ?? '')
      setLines(o.items.map((i: { medicineId: string; medicine: Medicine; quantity: number; mrp: number | string | null; unitPrice: number | string; offerPercent: number | string; salesTax: number | string; bonusQty: number }) => {
        const offer = offerItems.get(i.medicineId)
        return {
          medicine: { ...i.medicine, id: i.medicineId, tradePrice: null, mrp: i.mrp != null ? Number(i.mrp) : null, totalStock: 1 },
          quantity: i.quantity, mrp: i.mrp != null ? Number(i.mrp) : null,
          unitPrice: Number(i.unitPrice), offerPercent: Number(i.offerPercent), salesTax: Number(i.salesTax),
          bonusQty: i.bonusQty, rule: ruleFor(offer), basePrice: Number(offer?.specialPrice ?? i.unitPrice),
        } as OrderLine
      }))
    })
  }, [draftId, offersReady, offerItems])

  // Load preselected customer
  useEffect(() => {
    if (preselectedRetailerId) {
      fetch(`/api/retailers/${preselectedRetailerId}`)
        .then(r => r.json())
        .then(j => j.data && setSelectedCustomer({
          id: j.data.id, name: j.data.name,
          creditLimit: j.data.creditLimit,
          outstandingBalance: Number(j.data.outstandingBalance ?? 0),
          creditDays: j.data.creditDays,
        }))
    }
  }, [preselectedRetailerId])

  // Search customers
  useEffect(() => {
    if (!customerSearch || selectedCustomer) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/retailers?search=${encodeURIComponent(customerSearch)}&pageSize=8`)
      const j = await res.json()
      setCustomers(j.data ?? [])
      setShowCustomerDropdown(true)
    }, 300)
    return () => clearTimeout(t)
  }, [customerSearch, selectedCustomer])

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
      setLines(ls => ls.map(l => l.medicine.id === med.id ? repriceLine(l, l.quantity + 1) : l))
    } else {
      const offer = offerItems.get(med.id)
      const rule = ruleFor(offer)
      const basePrice = Number(offer?.specialPrice ?? med.tradePrice ?? 0)
      const salesTax = med.salesTaxApplicable ? resolveSalesTax(offer?.fefoSalesTax ?? null, offer ? Number(offer.salesTax) : null) : 0
      const base: OrderLine = { medicine: med, quantity: 1, mrp: med.mrp, unitPrice: basePrice, offerPercent: rule.offerPercent, salesTax, bonusQty: 0, rule, basePrice }
      setLines(ls => [...ls, repriceLine(base, 1)])
    }
    setMedSearch('')
    setShowMedDropdown(false)
  }

  const removeLine = (id: string) => setLines(ls => ls.filter(l => l.medicine.id !== id))

  // Quantity changes re-apply the offer rule (Bonus / Extra % / Net Price); a manual edit of any other
  // field sticks until the quantity next changes. Tax stays whatever is in the line (editable).
  const repriceLine = (l: OrderLine, quantity: number): OrderLine => {
    const p = priceOfferLine(l.rule, l.basePrice, quantity, { salesTax: l.salesTax, applicable: l.medicine.salesTaxApplicable })
    return { ...l, quantity, unitPrice: p.unitPrice, offerPercent: p.offerPercent, bonusQty: p.bonusQty }
  }

  const updateLine = (id: string, field: 'quantity' | 'unitPrice' | 'offerPercent' | 'salesTax' | 'bonusQty', value: number) => {
    setLines(ls => ls.map(l => {
      if (l.medicine.id !== id) return l
      return field === 'quantity' ? repriceLine(l, value) : { ...l, [field]: value }
    }))
  }

  const totalAmount = lines.reduce((sum, l) => sum + l.quantity * lineUnitTotal(l), 0)

  const handleSubmit = async (asDraft = false) => {
    if (!selectedCustomer) { toast.error('Select a customer'); return }
    if (lines.length === 0) { toast.error('Add at least one medicine'); return }

    // Credit limit check (a draft is not an invoice yet)
    if (!asDraft && selectedCustomer.creditLimit > 0 && selectedCustomer.outstandingBalance !== undefined) {
      const projected = selectedCustomer.outstandingBalance + totalAmount
      if (projected > selectedCustomer.creditLimit) {
        const proceed = confirm(
          `This sales invoice will exceed ${selectedCustomer.name}'s credit limit.\n\n` +
          `Outstanding: ${selectedCustomer.outstandingBalance.toLocaleString('en-PK', { minimumFractionDigits: 2 })}\n` +
          `This invoice: ${totalAmount.toLocaleString('en-PK', { minimumFractionDigits: 2 })}\n` +
          `Projected total: ${projected.toLocaleString('en-PK', { minimumFractionDigits: 2 })}\n` +
          `Credit limit: ${selectedCustomer.creditLimit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}\n\n` +
          `Proceed anyway?`
        )
        if (!proceed) return
      }
    }

    setSaving(true)
    const payload = {
      retailerId: selectedCustomer.id,
      notes,
      items: lines.map(l => ({
        medicineId: l.medicine.id,
        quantity: l.quantity,
        bonusQty: l.bonusQty,
        mrp: l.mrp,
        unitPrice: l.unitPrice,
        offerPercent: l.offerPercent,
        salesTax: l.medicine.salesTaxApplicable ? l.salesTax : 0,
      })),
    }
    const json = (body: object) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    let res: Response
    let id: string | null = draftId
    if (draftId) {
      res = await fetch(`/api/orders/${draftId}/draft`, json(payload))
      if (res.ok && !asDraft) res = await fetch(`/api/orders/${draftId}/status`, json({ status: 'PENDING' }))
    } else {
      res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ...(asDraft ? { status: 'DRAFT' } : {}) }),
      })
      if (res.ok) id = (await res.clone().json()).data.id
    }

    if (res.ok && id) {
      toast.success(asDraft ? 'Draft saved' : 'Sales invoice created')
      router.push(asDraft ? '/orders' : `/orders/${id}`)
    } else {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error ?? 'Failed to save sales invoice')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/orders"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <h1 className="text-2xl font-bold">Sales Invoice</h1>
      </div>

      {/* Customer Selection */}
      <Card className="overflow-visible">
        <CardHeader><CardTitle className="text-base">1. Select Customer</CardTitle></CardHeader>
        <CardContent>
          {selectedCustomer ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <div>
                  <p className="font-medium">{selectedCustomer.name}</p>
                  <p className="text-xs text-slate-500">
                    Credit Limit: {formatPKR(selectedCustomer.creditLimit)}
                    {selectedCustomer.outstandingBalance !== undefined && ` · Outstanding: ${formatPKR(selectedCustomer.outstandingBalance)}`}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedCustomer(null)}>
                  <X size={16} />
                </Button>
              </div>
              {selectedCustomer.creditLimit > 0 && selectedCustomer.outstandingBalance !== undefined && (() => {
                const outstanding = selectedCustomer.outstandingBalance
                const limit = selectedCustomer.creditLimit
                const projectedTotal = outstanding + totalAmount
                const utilizationPct = Math.round((outstanding / limit) * 100)
                const wouldExceed = projectedTotal > limit

                if (outstanding >= limit) {
                  return (
                    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
                      <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-red-700">
                        <strong>Credit limit fully utilized ({utilizationPct}%).</strong> Outstanding {formatPKR(outstanding)} has reached
                        the {formatPKR(limit)} limit. This sales invoice will exceed the credit limit.
                      </p>
                    </div>
                  )
                }
                if (wouldExceed) {
                  return (
                    <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm">
                      <AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
                      <p className="text-orange-700">
                        <strong>This sales invoice will exceed the credit limit.</strong> Outstanding {formatPKR(outstanding)} + invoice {formatPKR(totalAmount)} = {formatPKR(projectedTotal)},
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
                placeholder="Search customer by name or phone..."
                className="pl-9"
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                onFocus={() => customers.length > 0 && setShowCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
              />
              {showCustomerDropdown && customers.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg">
                  {customers.map(c => (
                    <button key={c.id} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm"
                      onMouseDown={async () => {
                        setCustomerSearch('')
                        setShowCustomerDropdown(false)
                        // Fetch full customer detail to get outstanding balance
                        const res = await fetch(`/api/retailers/${c.id}`)
                        const j = await res.json()
                        setSelectedCustomer({
                          id: j.data.id, name: j.data.name,
                          creditLimit: j.data.creditLimit,
                          outstandingBalance: Number(j.data.outstandingBalance ?? 0),
                          creditDays: j.data.creditDays,
                        })
                      }}>
                      {c.name}
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
          {lines.length > 0 && (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b text-slate-600 text-xs">
                    <th className="text-left py-1.5 pr-2">Medicine</th>
                    <th className="text-center py-1.5 px-1 w-16">Qty</th>
                    <th className="text-center py-1.5 px-1 w-16">Free</th>
                    <th className="text-right py-1.5 px-1 w-20">MRP</th>
                    <th className="text-right py-1.5 px-1 w-24">Trade Price</th>
                    <th className="text-right py-1.5 px-1 w-16">Disc %</th>
                    <th className="text-right py-1.5 px-1 w-20">S. Tax</th>
                    <th className="text-right py-1.5 px-1 w-28">Line Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => {
                    const lineTotal = l.quantity * lineUnitTotal(l)
                    return (
                      <tr key={l.medicine.id} className={`border-b ${l.medicine.totalStock === 0 ? 'bg-red-50' : ''}`}>
                        <td className="py-1.5 pr-2">
                          <div className="font-medium flex items-center gap-2 whitespace-nowrap">
                            {l.medicine.name}
                            {l.medicine.totalStock === 0 && (
                              <span className="inline-flex items-center gap-1 text-xs text-red-600 font-normal">
                                <AlertTriangle size={11} /> No stock
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 px-1 text-center">
                          <Input type="number" min="1" className="w-16 h-7 text-xs text-center"
                            value={l.quantity}
                            onChange={e => updateLine(l.medicine.id, 'quantity', parseInt(e.target.value) || 1)} />
                          {l.rule.commentType !== 'NONE' && l.rule.commentType !== 'EXPIRY' && (
                            <div className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">
                              {formatOfferComment({ ...l.rule, commentNetPrice: l.rule.commentNetPrice, offerPercent: l.rule.offerPercent }, null)}
                              {l.bonusQty > 0 ? `: ${l.bonusQty} free` : ''}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 px-1">
                          <Input type="number" min="0" step="1" className="w-16 h-7 text-xs text-center"
                            value={l.bonusQty}
                            onChange={e => updateLine(l.medicine.id, 'bonusQty', Math.max(0, parseInt(e.target.value) || 0))} />
                        </td>
                        <td className="py-1.5 px-1 text-right whitespace-nowrap">{l.mrp != null ? formatPKR(l.mrp) : '—'}</td>
                        <td className="py-1.5 px-1">
                          <Input type="number" step="0.01" className="w-24 h-7 text-xs text-right"
                            value={l.unitPrice}
                            onChange={e => updateLine(l.medicine.id, 'unitPrice', parseFloat(e.target.value) || 0)} />
                        </td>
                        <td className="py-1.5 px-1">
                          <Input type="number" min="0" max="100" step="0.5" className="w-16 h-7 text-xs text-right"
                            value={l.offerPercent}
                            onChange={e => updateLine(l.medicine.id, 'offerPercent', parseFloat(e.target.value) || 0)} />
                        </td>
                        <td className="py-1.5 px-1">
                          {l.medicine.salesTaxApplicable ? (
                            <Input type="number" min="0" step="0.01" className="w-20 h-7 text-xs text-right"
                              value={l.salesTax}
                              onChange={e => updateLine(l.medicine.id, 'salesTax', parseFloat(e.target.value) || 0)} />
                          ) : (
                            <span className="text-slate-300 text-xs block text-right pr-1">N/A</span>
                          )}
                        </td>
                        <td className="py-1.5 px-1 text-right font-medium whitespace-nowrap">{formatPKR(lineTotal)}</td>
                        <td className="py-1.5 px-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLine(l.medicine.id)}>
                            <Trash2 size={13} className="text-red-400" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td colSpan={7} className="pt-3 text-right font-semibold">Total:</td>
                    <td className="pt-3 text-right font-bold text-base whitespace-nowrap">{formatPKR(totalAmount)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Add another medicine — kept right under the last item row for fast repeated entry */}
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
                      <span className="text-slate-600 font-medium">{m.tradePrice != null ? formatPKR(m.tradePrice) : '—'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
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
            <Button variant="outline" onClick={() => handleSubmit(true)} disabled={saving || !selectedCustomer || lines.length === 0}>
              Save as draft
            </Button>
            <Button onClick={() => handleSubmit(false)} disabled={saving || !selectedCustomer || lines.length === 0}>
              {saving ? 'Saving...' : draftId ? 'Confirm' : 'Create Sales Invoice'}
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
