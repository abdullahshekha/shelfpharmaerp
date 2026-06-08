'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatPKR } from '@/lib/utils/format'
import { ArrowLeft, CheckCircle, XCircle, Search, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface FuzzyMatch {
  medicine: { id: string; code: string; name: string; tradePrice: number }
  score: number
  confidence: 'high' | 'medium' | 'low'
}

interface ExtractedItem {
  rawName: string
  cleanedName: string
  quantity: number
  unit: string
  dosage: string | null
  form: string
  matches: FuzzyMatch[]
  matchedMedicineId: string | null
  confidence: number
}

interface ReviewLine {
  rawName: string
  quantity: number
  selectedMedicineId: string
  selectedMedicineName: string
  unitPrice: number
  offerPercent: number
  included: boolean
  searchQuery: string
  searchResults: { id: string; name: string; code: string; tradePrice: number }[]
  showSearch: boolean
}

interface WaOrder {
  id: string
  phoneNumber: string
  status: string
  imageUrl: string
  retailerId: string | null
  retailer: { id: string; name: string } | null
  extractedItems: string | null
}


export default function WhatsappReviewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [waOrder, setWaOrder] = useState<WaOrder | null>(null)
  const [lines, setLines] = useState<ReviewLine[]>([])
  const [retailerId, setRetailerId] = useState('')
  const [retailerSearch, setRetailerSearch] = useState('')
  const [retailers, setRetailers] = useState<{ id: string; name: string }[]>([])
  const [showRetailerDropdown, setShowRetailerDropdown] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    fetch(`/api/whatsapp/${id}`)
      .then(r => r.json())
      .then(j => {
        const order: WaOrder = j.data
        setWaOrder(order)
        if (order.retailer) {
          setRetailerId(order.retailer.id)
          setRetailerSearch(order.retailer.name)
        }

        const items: ExtractedItem[] = order.extractedItems
          ? JSON.parse(order.extractedItems)
          : []

        setLines(items.map(item => {
          const topMatch = item.matches?.[0]
          return {
            rawName: item.rawName,
            quantity: item.quantity,
            selectedMedicineId: topMatch?.medicine?.id ?? '',
            selectedMedicineName: topMatch?.medicine?.name ?? '',
            unitPrice: topMatch?.medicine?.tradePrice ?? 0,
            offerPercent: 0,
            included: !!topMatch?.medicine?.id,
            searchQuery: '',
            searchResults: [],
            showSearch: false,
          }
        }))
      })
      .finally(() => setLoading(false))
  }, [id])

  // Retailer search
  useEffect(() => {
    if (!retailerSearch || retailerId) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/retailers?search=${encodeURIComponent(retailerSearch)}&pageSize=6`)
      const j = await res.json()
      setRetailers(j.data ?? [])
      setShowRetailerDropdown(true)
    }, 300)
    return () => clearTimeout(t)
  }, [retailerSearch, retailerId])

  const searchMedicine = useCallback(async (lineIdx: number, query: string) => {
    if (!query) {
      setLines(ls => ls.map((l, i) => i === lineIdx ? { ...l, searchResults: [], showSearch: false } : l))
      return
    }
    const res = await fetch(`/api/inventory?search=${encodeURIComponent(query)}&pageSize=6`)
    const j = await res.json()
    setLines(ls => ls.map((l, i) =>
      i === lineIdx ? { ...l, searchResults: j.data ?? [], showSearch: true } : l
    ))
  }, [])

  const selectMedicine = (lineIdx: number, med: { id: string; name: string; tradePrice: number }) => {
    setLines(ls => ls.map((l, i) =>
      i === lineIdx
        ? { ...l, selectedMedicineId: med.id, selectedMedicineName: med.name, unitPrice: med.tradePrice, showSearch: false, searchQuery: '', included: true }
        : l
    ))
  }

  const confirmOrder = async (force = false) => {
    if (!retailerId) { toast.error('Select a retailer first'); return }
    const included = lines.filter(l => l.included && l.selectedMedicineId)
    if (included.length === 0) { toast.error('No items to confirm'); return }

    setConfirming(true)
    const res = await fetch(`/api/whatsapp/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        retailerId,
        force,
        items: included.map(l => ({
          medicineId: l.selectedMedicineId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          offerPercent: l.offerPercent,
        })),
      }),
    })

    if (res.ok) {
      const j = await res.json()
      toast.success('Order created from WhatsApp image')
      router.push(`/orders/${j.data.id}`)
    } else {
      const j = await res.json()
      if (res.status === 409 && j.outOfStock) {
        setConfirming(false)
        const proceed = confirm(
          `${j.outOfStock.length} item(s) have no stock:\n\n${j.outOfStock.join('\n')}\n\nProceed anyway and exclude these items, or confirm order without stock?`
        )
        if (proceed) confirmOrder(true)
      } else {
        toast.error(j.error ?? 'Failed to confirm order')
        setConfirming(false)
      }
    }
  }

  const totalAmount = lines
    .filter(l => l.included && l.selectedMedicineId)
    .reduce((sum, l) => sum + l.quantity * l.unitPrice * (1 - l.offerPercent / 100), 0)

  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading…</div>
  if (!waOrder) return <div className="p-8 text-slate-400">Not found.</div>

  const includedCount = lines.filter(l => l.included && l.selectedMedicineId).length

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <Link href="/whatsapp"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Review WhatsApp Order</h1>
          <p className="text-slate-500 text-sm">{waOrder.phoneNumber} · {lines.length} items extracted</p>
        </div>
        <Badge className={waOrder.status === 'AI_PROCESSED' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}>
          {waOrder.status.replace('_', ' ')}
        </Badge>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: original image */}
        <Card>
          <CardHeader><CardTitle className="text-base">Original Image</CardTitle></CardHeader>
          <CardContent>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={waOrder.imageUrl}
              alt="Order image"
              className="w-full rounded-lg border object-contain max-h-[600px]"
            />
          </CardContent>
        </Card>

        {/* Right: review table */}
        <div className="space-y-4">
          {/* Retailer selection */}
          <Card className="overflow-visible">
            <CardHeader><CardTitle className="text-base">Retailer</CardTitle></CardHeader>
            <CardContent>
              {retailerId ? (
                <div className="flex items-center justify-between p-2 bg-blue-50 rounded">
                  <span className="font-medium">{retailerSearch}</span>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setRetailerId(''); setRetailerSearch('') }}>
                    Change
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Search retailer…"
                    className="pl-8 text-sm"
                    value={retailerSearch}
                    onChange={e => { setRetailerSearch(e.target.value); setRetailerId('') }}
                    onBlur={() => setTimeout(() => setShowRetailerDropdown(false), 200)}
                  />
                  {showRetailerDropdown && retailers.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg">
                      {retailers.map(r => (
                        <button key={r.id} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                          onMouseDown={() => { setRetailerId(r.id); setRetailerSearch(r.name); setShowRetailerDropdown(false) }}>
                          {r.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Items */}
          <Card className="overflow-visible">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Extracted Items ({includedCount}/{lines.length} included)</span>
                <span className="font-bold text-base">{formatPKR(totalAmount)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className={`border rounded-lg p-3 space-y-2 transition-all ${
                    !line.included ? 'opacity-40 bg-slate-50 border-slate-200' : 'border-slate-300'
                  }`}
                >
                  {/* Raw extracted name + include/exclude toggle */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-400 italic truncate flex-1">&ldquo;{line.rawName}&rdquo;</p>
                    <button
                      onClick={() => setLines(ls => ls.map((l, j) => j === i ? { ...l, included: !l.included } : l))}
                      className={`flex-shrink-0 flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border transition-colors ${
                        line.included
                          ? 'text-green-700 border-green-300 bg-green-50 hover:bg-red-50 hover:text-red-600 hover:border-red-300'
                          : 'text-slate-400 border-slate-300 bg-slate-100 hover:bg-green-50 hover:text-green-700 hover:border-green-300'
                      }`}
                    >
                      {line.included
                        ? <><CheckCircle size={12} /> Included</>
                        : <><XCircle size={12} /> Excluded</>
                      }
                    </button>
                  </div>

                  {/* Matched medicine */}
                  <div className="relative">
                    {line.selectedMedicineId ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 text-sm font-medium text-slate-900 truncate">
                          {line.selectedMedicineName}
                        </div>
                        <button
                          className="text-xs text-blue-500 hover:underline flex-shrink-0"
                          onClick={() => setLines(ls => ls.map((l, j) =>
                            j === i ? { ...l, showSearch: true, searchQuery: l.selectedMedicineName } : l
                          ))}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-sm text-red-600">
                        <AlertTriangle size={14} />
                        <span>No match found — search below</span>
                      </div>
                    )}

                    {/* Medicine search */}
                    {(line.showSearch || !line.selectedMedicineId) && (
                      <div className="mt-1 relative">
                        <Input
                          placeholder="Search medicine…"
                          className="text-xs h-8"
                          value={line.searchQuery}
                          onChange={e => {
                            const q = e.target.value
                            setLines(ls => ls.map((l, j) => j === i ? { ...l, searchQuery: q } : l))
                            searchMedicine(i, q)
                          }}
                          onBlur={() => setTimeout(() =>
                            setLines(ls => ls.map((l, j) => j === i ? { ...l, showSearch: false } : l)), 200
                          )}
                          autoFocus={!line.selectedMedicineId}
                        />
                        {line.showSearch && line.searchResults.length > 0 && (
                          <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {line.searchResults.map(m => (
                              <button
                                key={m.id}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex justify-between"
                                onMouseDown={() => selectMedicine(i, m)}
                              >
                                <span className="font-medium">{m.name}</span>
                                <span className="text-slate-400">{formatPKR(m.tradePrice)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Quantity + price row */}
                  {line.included && line.selectedMedicineId && (
                    <div className="flex items-center gap-2 text-xs">
                      <label className="text-slate-500">Qty</label>
                      <Input
                        type="number" min="1"
                        className="w-16 h-7 text-xs text-center"
                        value={line.quantity}
                        onChange={e => setLines(ls => ls.map((l, j) =>
                          j === i ? { ...l, quantity: parseInt(e.target.value) || 1 } : l
                        ))}
                      />
                      <label className="text-slate-500">Offer%</label>
                      <Input
                        type="number" min="0" max="100"
                        className="w-16 h-7 text-xs text-center"
                        value={line.offerPercent}
                        onChange={e => setLines(ls => ls.map((l, j) =>
                          j === i ? { ...l, offerPercent: parseFloat(e.target.value) || 0 } : l
                        ))}
                      />
                      <span className="ml-auto font-medium text-slate-700">
                        {formatPKR(line.quantity * line.unitPrice * (1 - line.offerPercent / 100))}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Confirm button */}
          {waOrder.status !== 'CONFIRMED' && (
            <Button
              className="w-full"
              size="lg"
              onClick={() => confirmOrder()}
              disabled={confirming || includedCount === 0 || !retailerId}
            >
              {confirming ? 'Creating Order…' : `Confirm Order (${includedCount} items · ${formatPKR(totalAmount)})`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
