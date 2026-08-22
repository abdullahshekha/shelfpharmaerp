'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { calcPurchasePrice, calcTradeOfferPercent, calcAitAmount, calcSalesTaxAmount } from '@/lib/utils/pricing'
import { ArrowLeft, Plus, X, Search } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface Medicine {
  id: string; name: string; code: string
  tradePrice: number | null; mrp: number | null; salesTaxApplicable: boolean
}

interface PriorBatch { mrp: number | null; purchasePrice: number; createdAt: string }

interface InvoiceItem {
  medicineId: string
  medicineName: string
  salesTaxApplicable: boolean
  batchNumber: string
  expiryDate: string
  quantity: number
  bonusQuantity: number
  tradePrice: number
  mrp: string
  discountPercent: number
  salesTax: number
  aitCollectiblePercent: number
  aitPayablePercent: number
  priorBatches: PriorBatch[]
}

interface Payment { id: string; amount: number; paymentDate: string; method: string; reference: string | null }

interface Batch { id: string; batchNumber: string; expiryDate: string; currentQty: number; purchasePrice: number }

interface ReturnItem {
  medicineId: string
  medicineName: string
  batches: Batch[]
  batchId: string
  quantity: number
  reason: string
}

interface SupplierReturn {
  id: string
  returnNumber: string
  returnDate: string
  totalAmount: number
  notes: string | null
  items: {
    id: string; quantity: number; purchasePrice: number; lineTotal: number; reason: string | null
    medicine: { name: string; code: string }
  }[]
}

interface PurchaseInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  totalAmount: number
  salesTaxTotal: number
  aitCollectibleTotal: number
  aitPayableTotal: number
  previousPayable: number
  grandTotal: number
  status: string
  notes: string | null
  items: {
    id: string; quantity: number; bonusQuantity: number; purchasePrice: number; lineTotal: number
    medicine: { name: string; code: string }
  }[]
  payments: Payment[]
}

interface Supplier {
  id: string; name: string; type: string; contactPerson: string | null
  phone: string | null; address: string | null; notes: string | null
  isFiler: boolean; ntnNumber: string | null; strnStatus: string | null
  strnNumber: string | null; drugLicenseNumber: string | null
  purchaseInvoices: PurchaseInvoice[]
  supplierReturns: SupplierReturn[]
}

const STATUS_COLORS: Record<string, string> = {
  UNPAID: 'bg-red-100 text-red-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID: 'bg-green-100 text-green-700',
}

const emptyPayment = { amount: '', method: 'CASH', reference: '', paymentDate: new Date().toISOString().slice(0, 10) }

function itemPurchasePrice(item: InvoiceItem) {
  const tradeOfferPercent = calcTradeOfferPercent(item.quantity, item.bonusQuantity)
  return calcPurchasePrice({
    tradePrice: item.tradePrice,
    discountPercent: item.discountPercent,
    tradeOfferPercent,
  })
}

function itemTotalQuantity(item: InvoiceItem) {
  return item.quantity + item.bonusQuantity
}

function itemSalesTaxAmount(item: InvoiceItem) {
  if (!item.salesTaxApplicable) return 0
  return calcSalesTaxAmount(item.salesTax, itemTotalQuantity(item))
}

function itemAitCollectibleAmount(item: InvoiceItem, isFiler: boolean) {
  if (!isFiler) return 0
  return calcAitAmount(item.tradePrice, item.aitCollectiblePercent, itemTotalQuantity(item))
}

function itemAitPayableAmount(item: InvoiceItem, isFiler: boolean) {
  if (!isFiler) return 0
  return calcAitAmount(item.tradePrice, item.aitPayablePercent, itemTotalQuantity(item))
}

/** Warn if this item's Purchase Price exceeds the most recent batch's Purchase Price at the same MRP. */
function itemPriceWarning(item: InvoiceItem): { oldPrice: number } | null {
  const mrpNum = parseFloat(item.mrp)
  if (!Number.isFinite(mrpNum)) return null
  const matches = item.priorBatches.filter((b) => b.mrp != null && Math.abs(Number(b.mrp) - mrpNum) < 0.005)
  if (matches.length === 0) return null
  const mostRecent = matches.reduce((a, b) => (new Date(b.createdAt) > new Date(a.createdAt) ? b : a))
  const newPrice = itemPurchasePrice(item)
  if (newPrice > mostRecent.purchasePrice + 0.005) return { oldPrice: mostRecent.purchasePrice }
  return null
}

/** Supplier's current outstanding balance: unpaid purchase invoices, minus returned goods credited back. */
function computeSupplierOutstanding(supplier: Supplier): number {
  const invoiceBalance = supplier.purchaseInvoices.reduce((sum, inv) => {
    if (inv.status === 'PAID') return sum
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0)
    return sum + (Number(inv.totalAmount) - paid)
  }, 0)
  const returnsTotal = supplier.supplierReturns.reduce((sum, r) => sum + Number(r.totalAmount), 0)
  return invoiceBalance - returnsTotal
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)

  // New invoice form
  const [showInvoiceForm, setShowInvoiceForm] = useState(false)
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [previousPayable, setPreviousPayable] = useState('0')
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [medSearch, setMedSearch] = useState('')
  const [medResults, setMedResults] = useState<Medicine[]>([])
  const [showMedDrop, setShowMedDrop] = useState(false)
  const [savingInvoice, setSavingInvoice] = useState(false)

  // Payment form
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null)
  const [paymentForm, setPaymentForm] = useState(emptyPayment)
  const [savingPayment, setSavingPayment] = useState(false)

  // Return invoice form
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10))
  const [returnNotes, setReturnNotes] = useState('')
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([])
  const [returnMedSearch, setReturnMedSearch] = useState('')
  const [returnMedResults, setReturnMedResults] = useState<Medicine[]>([])
  const [showReturnMedDrop, setShowReturnMedDrop] = useState(false)
  const [savingReturn, setSavingReturn] = useState(false)

  const fetchSupplier = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/suppliers/${id}`)
    const j = await res.json()
    setSupplier(j.data)
    setLoading(false)
  }, [id])

  useEffect(() => { fetchSupplier() }, [fetchSupplier])

  // Medicine search for invoice form
  useEffect(() => {
    if (!medSearch) { setMedResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/inventory?search=${encodeURIComponent(medSearch)}&pageSize=8`)
      const j = await res.json()
      setMedResults(j.data ?? [])
      setShowMedDrop(true)
    }, 300)
    return () => clearTimeout(t)
  }, [medSearch])

  // Items not subject to Sales Tax have their Trade Price auto-calculated as 85% of MRP (a fixed
  // trade margin convention for these items) — still a plain editable field, this is just the
  // starting value whenever MRP is known.
  const nonTaxTradePrice = (mrp: number) => Math.round(mrp * 0.85 * 100) / 100

  const addItem = async (med: Medicine) => {
    const initialTradePrice = !med.salesTaxApplicable && med.mrp != null
      ? nonTaxTradePrice(med.mrp)
      : (med.tradePrice ?? 0)
    setItems(prev => [...prev, {
      medicineId: med.id,
      medicineName: med.name,
      salesTaxApplicable: med.salesTaxApplicable,
      batchNumber: '',
      expiryDate: '',
      quantity: 1,
      bonusQuantity: 0,
      tradePrice: initialTradePrice,
      mrp: med.mrp != null ? String(med.mrp) : '',
      discountPercent: 0,
      salesTax: 0,
      aitCollectiblePercent: 0,
      aitPayablePercent: 0,
      priorBatches: [],
    }])
    setMedSearch('')
    setShowMedDrop(false)

    // Fetch batch history so we can flag a Purchase Price increase at the same MRP.
    const res = await fetch(`/api/inventory/${med.id}`)
    const j = await res.json()
    const priorBatches: PriorBatch[] = (j.data?.batches ?? []).map((b: { mrp: number | null; purchasePrice: number; createdAt: string }) => ({
      mrp: b.mrp, purchasePrice: Number(b.purchasePrice), createdAt: b.createdAt,
    }))
    setItems(prev => prev.map(i => i.medicineId === med.id ? { ...i, priorBatches } : i))
  }

  const updateItem = (medicineId: string, patch: Partial<InvoiceItem>) => {
    setItems(prev => prev.map(i => i.medicineId === medicineId ? { ...i, ...patch } : i))
  }

  // Medicine search for return form
  useEffect(() => {
    if (!returnMedSearch) { setReturnMedResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/inventory?search=${encodeURIComponent(returnMedSearch)}&pageSize=8`)
      const j = await res.json()
      setReturnMedResults(j.data ?? [])
      setShowReturnMedDrop(true)
    }, 300)
    return () => clearTimeout(t)
  }, [returnMedSearch])

  const addReturnItem = async (med: Medicine) => {
    setReturnMedSearch('')
    setShowReturnMedDrop(false)
    const res = await fetch(`/api/inventory/${med.id}`)
    const j = await res.json()
    const batches: Batch[] = (j.data?.batches ?? [])
      .filter((b: { currentQty: number }) => b.currentQty > 0)
      .map((b: { id: string; batchNumber: string; expiryDate: string; currentQty: number; purchasePrice: number }) => ({
        id: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, currentQty: b.currentQty, purchasePrice: Number(b.purchasePrice),
      }))
    if (batches.length === 0) {
      toast.error(`${med.name} has no in-stock batches to return`)
      return
    }
    setReturnItems(prev => [...prev, {
      medicineId: med.id,
      medicineName: med.name,
      batches,
      batchId: batches[0].id,
      quantity: 1,
      reason: '',
    }])
  }

  const updateReturnItem = (medicineId: string, patch: Partial<ReturnItem>) => {
    setReturnItems(prev => prev.map(i => i.medicineId === medicineId ? { ...i, ...patch } : i))
  }

  const createReturn = async () => {
    if (returnItems.length === 0) { toast.error('Add at least one medicine'); return }
    for (const item of returnItems) {
      const batch = item.batches.find(b => b.id === item.batchId)
      if (!item.quantity || (batch && item.quantity > batch.currentQty)) {
        toast.error(`${item.medicineName}: quantity must be between 1 and ${batch?.currentQty ?? 0}`)
        return
      }
    }
    setSavingReturn(true)
    const res = await fetch(`/api/suppliers/${id}/returns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        returnDate,
        notes: returnNotes || null,
        items: returnItems.map(i => ({
          medicineId: i.medicineId,
          batchId: i.batchId,
          quantity: i.quantity,
          reason: i.reason || null,
        })),
      }),
    })
    if (res.ok) {
      toast.success('Return invoice created')
      setShowReturnForm(false)
      setReturnItems([])
      setReturnNotes('')
      fetchSupplier()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to create return')
    }
    setSavingReturn(false)
  }

  const isFiler = supplier?.isFiler ?? false

  const createInvoice = async () => {
    if (items.length === 0) { toast.error('Add at least one medicine'); return }
    for (const item of items) {
      if (!item.batchNumber || !item.expiryDate || !item.quantity || !item.tradePrice) {
        toast.error(`${item.medicineName}: batch number, expiry date, quantity and trade price are required`)
        return
      }
    }
    setSavingInvoice(true)
    const res = await fetch('/api/purchase-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId: id,
        invoiceDate,
        notes: invoiceNotes || null,
        previousPayable: parseFloat(previousPayable) || 0,
        items: items.map(i => ({
          medicineId: i.medicineId,
          batchNumber: i.batchNumber,
          expiryDate: i.expiryDate,
          quantity: i.quantity,
          bonusQuantity: i.bonusQuantity,
          tradePrice: i.tradePrice,
          mrp: i.mrp ? parseFloat(i.mrp) : null,
          discountPercent: i.discountPercent,
          salesTax: i.salesTaxApplicable ? i.salesTax : 0,
          aitCollectiblePercent: isFiler ? i.aitCollectiblePercent : 0,
          aitPayablePercent: isFiler ? i.aitPayablePercent : 0,
        })),
      }),
    })
    if (res.ok) {
      toast.success('Purchase invoice created')
      setShowInvoiceForm(false)
      setItems([])
      setInvoiceNotes('')
      setPreviousPayable('0')
      fetchSupplier()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to create invoice')
    }
    setSavingInvoice(false)
  }

  const recordPayment = async (invoiceId: string) => {
    if (!paymentForm.amount || Number(paymentForm.amount) <= 0) { toast.error('Enter a valid amount'); return }
    setSavingPayment(true)
    const res = await fetch(`/api/purchase-invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentForm),
    })
    if (res.ok) {
      toast.success('Payment recorded')
      setPayingInvoiceId(null)
      setPaymentForm(emptyPayment)
      fetchSupplier()
    } else {
      toast.error('Failed to record payment')
    }
    setSavingPayment(false)
  }

  const invoiceExclTaxTotal = items.reduce((s, i) => s + itemTotalQuantity(i) * itemPurchasePrice(i), 0)
  const invoiceSalesTaxTotal = items.reduce((s, i) => s + itemSalesTaxAmount(i), 0)
  const invoiceAitCollectibleTotal = items.reduce((s, i) => s + itemAitCollectibleAmount(i, isFiler), 0)
  const invoiceAitPayableTotal = items.reduce((s, i) => s + itemAitPayableAmount(i, isFiler), 0)
  const invoiceTotal = invoiceExclTaxTotal + invoiceSalesTaxTotal - invoiceAitCollectibleTotal + invoiceAitPayableTotal
  const invoiceGrandTotal = invoiceTotal + (parseFloat(previousPayable) || 0)

  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading...</div>
  if (!supplier) return <div className="p-8 text-slate-400">Supplier not found.</div>

  const totalOwed = computeSupplierOutstanding(supplier)

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/suppliers"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{supplier.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge className={supplier.type === 'OFFICIAL_DISTRIBUTOR' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}>
              {supplier.type === 'OFFICIAL_DISTRIBUTOR' ? 'Official Distributor' : 'Open Market'}
            </Badge>
            <Badge variant="outline">{supplier.isFiler ? 'Filer' : 'Non-Filer'}</Badge>
            {totalOwed > 0 && (
              <span className="text-sm text-red-600 font-medium">Outstanding: {formatPKR(totalOwed)}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowReturnForm(true)} className="gap-2">
            <Plus size={16} /> Return Invoice
          </Button>
          <Button onClick={() => { setPreviousPayable(String(computeSupplierOutstanding(supplier))); setShowInvoiceForm(true) }} className="gap-2">
            <Plus size={16} /> New Purchase Invoice
          </Button>
        </div>
      </div>

      {/* Supplier info */}
      <div className="grid sm:grid-cols-3 gap-3 text-sm text-slate-600">
        {supplier.contactPerson && <div><span className="text-slate-400">Contact:</span> {supplier.contactPerson}</div>}
        {supplier.phone && <div><span className="text-slate-400">Phone:</span> {supplier.phone}</div>}
        {supplier.address && <div><span className="text-slate-400">Address:</span> {supplier.address}</div>}
        {supplier.isFiler && supplier.ntnNumber && <div><span className="text-slate-400">NTN:</span> {supplier.ntnNumber}</div>}
        {supplier.isFiler && (
          <div>
            <span className="text-slate-400">STRN:</span>{' '}
            {supplier.strnStatus === 'REGISTERED' ? supplier.strnNumber : 'Unregistered'}
          </div>
        )}
        {supplier.drugLicenseNumber && <div><span className="text-slate-400">Drug License:</span> {supplier.drugLicenseNumber}</div>}
      </div>

      {/* New invoice form */}
      {showInvoiceForm && (
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              New Purchase Invoice
              <button onClick={() => { setShowInvoiceForm(false); setItems([]); setPreviousPayable('0') }}><X size={16} className="text-slate-400" /></button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Invoice Date</Label>
                <Input type="date" className="h-8 text-sm" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Input className="h-8 text-sm" placeholder="Optional notes" value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)} />
              </div>
            </div>

            {/* Items table */}
            {items.length > 0 && (
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full text-sm min-w-[1100px]">
                  <thead>
                    <tr className="border-b text-slate-600 text-xs">
                      <th className="text-left py-1.5 pr-2">Medicine</th>
                      <th className="text-left py-1.5 px-1 w-28">Batch #</th>
                      <th className="text-left py-1.5 px-1 w-32">Expiry</th>
                      <th className="text-center py-1.5 px-1 w-16">Qty</th>
                      <th className="text-center py-1.5 px-1 w-16">Bonus Qty</th>
                      <th className="text-right py-1.5 px-1 w-20">MRP</th>
                      <th className="text-right py-1.5 px-1 w-24">Trade Price</th>
                      <th className="text-right py-1.5 px-1 w-16">Disc %</th>
                      <th className="text-right py-1.5 px-1 w-20">S. Tax</th>
                      {isFiler && <th className="text-right py-1.5 px-1 w-16">Adv Tax-C %</th>}
                      {isFiler && <th className="text-right py-1.5 px-1 w-16">Adv Tax-P %</th>}
                      <th className="text-right py-1.5 px-1 w-24">Purchase Price</th>
                      <th className="text-right py-1.5 px-1 w-24">Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => {
                      const purchasePrice = itemPurchasePrice(item)
                      return (
                        <tr key={item.medicineId} className="border-b">
                          <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{item.medicineName}</td>
                          <td className="py-1.5 px-1">
                            <Input placeholder="Batch #" className="w-28 h-7 text-xs"
                              value={item.batchNumber}
                              onChange={e => updateItem(item.medicineId, { batchNumber: e.target.value })} />
                          </td>
                          <td className="py-1.5 px-1">
                            <Input type="date" className="w-32 h-7 text-xs"
                              value={item.expiryDate}
                              onChange={e => updateItem(item.medicineId, { expiryDate: e.target.value })} />
                          </td>
                          <td className="py-1.5 px-1 text-center">
                            <Input type="number" min="1" className="w-16 h-7 text-xs text-center"
                              value={item.quantity}
                              onChange={e => updateItem(item.medicineId, { quantity: parseInt(e.target.value) || 1 })} />
                          </td>
                          <td className="py-1.5 px-1 text-center">
                            <Input type="number" min="0" className="w-16 h-7 text-xs text-center"
                              value={item.bonusQuantity}
                              onChange={e => updateItem(item.medicineId, { bonusQuantity: parseInt(e.target.value) || 0 })} />
                          </td>
                          <td className="py-1.5 px-1">
                            <Input type="number" step="0.01" className="w-20 h-7 text-xs text-right"
                              value={item.mrp}
                              onChange={e => {
                                const mrp = e.target.value
                                const parsed = parseFloat(mrp)
                                const patch: Partial<InvoiceItem> = { mrp }
                                if (!item.salesTaxApplicable && !isNaN(parsed)) patch.tradePrice = nonTaxTradePrice(parsed)
                                updateItem(item.medicineId, patch)
                              }} />
                          </td>
                          <td className="py-1.5 px-1">
                            <Input type="number" step="0.01" className="w-24 h-7 text-xs text-right"
                              value={item.tradePrice}
                              onChange={e => updateItem(item.medicineId, { tradePrice: parseFloat(e.target.value) || 0 })} />
                          </td>
                          <td className="py-1.5 px-1">
                            <Input type="number" min="0" max="100" step="0.01" className="w-16 h-7 text-xs text-right"
                              value={item.discountPercent}
                              onChange={e => updateItem(item.medicineId, { discountPercent: parseFloat(e.target.value) || 0 })} />
                          </td>
                          <td className="py-1.5 px-1">
                            {item.salesTaxApplicable ? (
                              <Input type="number" min="0" step="0.01" className="w-20 h-7 text-xs text-right"
                                value={item.salesTax}
                                onChange={e => updateItem(item.medicineId, { salesTax: parseFloat(e.target.value) || 0 })} />
                            ) : (
                              <span className="text-slate-300 text-xs block text-right pr-1">N/A</span>
                            )}
                          </td>
                          {isFiler && (
                            <td className="py-1.5 px-1">
                              <Input type="number" min="0" max="100" step="0.01" className="w-16 h-7 text-xs text-right"
                                value={item.aitCollectiblePercent}
                                onChange={e => updateItem(item.medicineId, { aitCollectiblePercent: parseFloat(e.target.value) || 0 })} />
                            </td>
                          )}
                          {isFiler && (
                            <td className="py-1.5 px-1">
                              <Input type="number" min="0" max="100" step="0.01" className="w-16 h-7 text-xs text-right"
                                value={item.aitPayablePercent}
                                onChange={e => updateItem(item.medicineId, { aitPayablePercent: parseFloat(e.target.value) || 0 })} />
                            </td>
                          )}
                          <td className="py-1.5 px-1 text-right font-medium whitespace-nowrap">
                            {formatPKR(purchasePrice)}
                            {itemPriceWarning(item) && (
                              <div className="text-orange-600 font-normal text-[10px] whitespace-nowrap">
                                ⚠ was {formatPKR(itemPriceWarning(item)!.oldPrice)}
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 px-1 text-right font-medium whitespace-nowrap">{formatPKR(purchasePrice * itemTotalQuantity(item))}</td>
                          <td className="py-1.5 px-1">
                            <button className="text-slate-400 hover:text-red-500"
                              onClick={() => setItems(prev => prev.filter(i => i.medicineId !== item.medicineId))}>
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Add another medicine — kept right under the last item row for fast repeated entry */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search medicine to add..."
                className="pl-9 text-sm"
                value={medSearch}
                onChange={e => setMedSearch(e.target.value)}
                onBlur={() => setTimeout(() => setShowMedDrop(false), 200)}
              />
              {showMedDrop && medResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {medResults.map(m => (
                    <button key={m.id} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between"
                      onMouseDown={() => addItem(m)}>
                      <span className="font-medium">{m.name}</span>
                      <span className="text-slate-400 font-mono text-xs">{m.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Totals breakdown */}
            {items.length > 0 && (
              <div className="flex justify-end">
                <div className="w-full sm:w-80 space-y-1 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Total (exc. taxes)</span>
                    <span>{formatPKR(invoiceExclTaxTotal)}</span>
                  </div>
                  {invoiceSalesTaxTotal > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Total Sales Tax</span>
                      <span>{formatPKR(invoiceSalesTaxTotal)}</span>
                    </div>
                  )}
                  {isFiler && (
                    <>
                      <div className="flex justify-between text-slate-600">
                        <span>Adv Tax Collectible</span>
                        <span className="text-red-600">-{formatPKR(invoiceAitCollectibleTotal)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Adv Tax Payable</span>
                        <span>{formatPKR(invoiceAitPayableTotal)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Invoice Total</span>
                    <span>{formatPKR(invoiceTotal)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 pt-1">
                    <Label className="text-xs">Previous Payable</Label>
                    <Input type="number" step="0.01" className="w-32 h-7 text-xs text-right"
                      value={previousPayable}
                      onChange={e => setPreviousPayable(e.target.value)} />
                  </div>
                  <div className="flex justify-between font-bold text-base border-t pt-1">
                    <span>Grand Total</span>
                    <span>{formatPKR(invoiceGrandTotal)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowInvoiceForm(false); setItems([]); setPreviousPayable('0') }}>Cancel</Button>
              <Button size="sm" onClick={createInvoice} disabled={savingInvoice || items.length === 0}>
                {savingInvoice ? 'Creating...' : `Create Invoice (${formatPKR(invoiceTotal)})`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Return invoice form */}
      {showReturnForm && (
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              Return Invoice
              <button onClick={() => { setShowReturnForm(false); setReturnItems([]) }}><X size={16} className="text-slate-400" /></button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Return Date</Label>
                <Input type="date" className="h-8 text-sm" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Input className="h-8 text-sm" placeholder="Optional notes" value={returnNotes} onChange={e => setReturnNotes(e.target.value)} />
              </div>
            </div>

            {returnItems.length > 0 && (
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b text-slate-600 text-xs">
                      <th className="text-left py-1.5 pr-2">Medicine</th>
                      <th className="text-left py-1.5 px-1 w-56">Batch</th>
                      <th className="text-center py-1.5 px-1 w-20">Qty</th>
                      <th className="text-right py-1.5 px-1 w-24">Purchase Price</th>
                      <th className="text-right py-1.5 px-1 w-24">Total</th>
                      <th className="text-left py-1.5 px-1">Reason</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {returnItems.map(item => {
                      const batch = item.batches.find(b => b.id === item.batchId)
                      const lineTotal = (batch ? batch.purchasePrice : 0) * item.quantity
                      return (
                        <tr key={item.medicineId} className="border-b">
                          <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{item.medicineName}</td>
                          <td className="py-1.5 px-1">
                            <Select
                              items={item.batches.map(b => ({ value: b.id, label: `${b.batchNumber} (exp ${formatDate(b.expiryDate)}, ${b.currentQty} in stock)` }))}
                              value={item.batchId}
                              onValueChange={v => updateReturnItem(item.medicineId, { batchId: v ?? item.batchId })}
                            >
                              <SelectTrigger className="h-7 text-xs w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {item.batches.map(b => (
                                  <SelectItem key={b.id} value={b.id}>
                                    {b.batchNumber} (exp {formatDate(b.expiryDate)}, {b.currentQty} in stock)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-1.5 px-1 text-center">
                            <Input type="number" min="1" max={batch?.currentQty ?? 1} className="w-16 h-7 text-xs text-center mx-auto"
                              value={item.quantity}
                              onChange={e => updateReturnItem(item.medicineId, { quantity: parseInt(e.target.value) || 1 })} />
                          </td>
                          <td className="py-1.5 px-1 text-right whitespace-nowrap">{formatPKR(batch?.purchasePrice ?? 0)}</td>
                          <td className="py-1.5 px-1 text-right font-medium whitespace-nowrap">{formatPKR(lineTotal)}</td>
                          <td className="py-1.5 px-1">
                            <Input placeholder="Optional" className="h-7 text-xs"
                              value={item.reason}
                              onChange={e => updateReturnItem(item.medicineId, { reason: e.target.value })} />
                          </td>
                          <td className="py-1.5 px-1">
                            <button className="text-slate-400 hover:text-red-500"
                              onClick={() => setReturnItems(prev => prev.filter(i => i.medicineId !== item.medicineId))}>
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search medicine to return..."
                className="pl-9 text-sm"
                value={returnMedSearch}
                onChange={e => setReturnMedSearch(e.target.value)}
                onBlur={() => setTimeout(() => setShowReturnMedDrop(false), 200)}
              />
              {showReturnMedDrop && returnMedResults.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {returnMedResults.map(m => (
                    <button key={m.id} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between"
                      onMouseDown={() => addReturnItem(m)}>
                      <span className="font-medium">{m.name}</span>
                      <span className="text-slate-400 font-mono text-xs">{m.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {returnItems.length > 0 && (
              <div className="flex justify-end">
                <div className="w-full sm:w-72 flex justify-between font-bold text-base border-t pt-1">
                  <span>Return Total</span>
                  <span>
                    {formatPKR(returnItems.reduce((s, i) => {
                      const b = i.batches.find(bb => bb.id === i.batchId)
                      return s + (b ? b.purchasePrice : 0) * i.quantity
                    }, 0))}
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowReturnForm(false); setReturnItems([]) }}>Cancel</Button>
              <Button size="sm" onClick={createReturn} disabled={savingReturn || returnItems.length === 0}>
                {savingReturn ? 'Creating...' : 'Create Return'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Purchase Invoices */}
      <Card>
        <CardHeader><CardTitle className="text-base">Purchase Invoices ({supplier.purchaseInvoices.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {supplier.purchaseInvoices.length === 0 ? (
            <p className="text-sm text-slate-400 p-6">No purchase invoices yet.</p>
          ) : (
            <div className="divide-y">
              {supplier.purchaseInvoices.map(inv => {
                const totalPaid = inv.payments.reduce((s, p) => s + Number(p.amount), 0)
                const balance = Number(inv.totalAmount) - totalPaid
                return (
                  <div key={inv.id} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono font-medium text-sm">{inv.invoiceNumber}</p>
                        <p className="text-xs text-slate-500">{formatDate(inv.invoiceDate)} · {inv.items.length} items</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{formatPKR(inv.totalAmount)}</p>
                        <Badge className={`text-xs ${STATUS_COLORS[inv.status] ?? ''}`}>{inv.status}</Badge>
                      </div>
                    </div>

                    {/* Items summary */}
                    <div className="bg-slate-50 rounded p-2 space-y-1">
                      {inv.items.map(item => (
                        <div key={item.id} className="flex justify-between text-xs text-slate-600">
                          <span>
                            {item.medicine.name}
                            {item.bonusQuantity > 0 && <span className="text-slate-400"> ({item.quantity} + {item.bonusQuantity} bonus)</span>}
                          </span>
                          <span>{item.quantity + item.bonusQuantity} × {formatPKR(item.purchasePrice)} = {formatPKR(item.lineTotal)}</span>
                        </div>
                      ))}
                      {(Number(inv.salesTaxTotal) > 0 || Number(inv.aitCollectibleTotal) > 0 || Number(inv.aitPayableTotal) > 0) && (
                        <div className="pt-1 mt-1 border-t space-y-0.5">
                          {Number(inv.salesTaxTotal) > 0 && (
                            <div className="flex justify-between text-xs text-slate-500">
                              <span>Total Sales Tax</span><span>{formatPKR(inv.salesTaxTotal)}</span>
                            </div>
                          )}
                          {Number(inv.aitCollectibleTotal) > 0 && (
                            <div className="flex justify-between text-xs text-slate-500">
                              <span>Adv Tax Collectible</span><span className="text-red-600">-{formatPKR(inv.aitCollectibleTotal)}</span>
                            </div>
                          )}
                          {Number(inv.aitPayableTotal) > 0 && (
                            <div className="flex justify-between text-xs text-slate-500">
                              <span>Adv Tax Payable</span><span>{formatPKR(inv.aitPayableTotal)}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {Number(inv.previousPayable) > 0 && (
                        <div className="pt-1 mt-1 border-t space-y-0.5">
                          <div className="flex justify-between text-xs text-slate-500">
                            <span>Previous Payable</span><span>{formatPKR(inv.previousPayable)}</span>
                          </div>
                          <div className="flex justify-between text-xs font-semibold">
                            <span>Grand Total</span><span>{formatPKR(inv.grandTotal)}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Payments */}
                    {inv.payments.length > 0 && (
                      <div className="space-y-1">
                        {inv.payments.map(p => (
                          <div key={p.id} className="flex justify-between text-xs text-slate-500">
                            <span>{formatDate(p.paymentDate)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                            <span className="text-green-600 font-medium">+{formatPKR(p.amount)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs font-semibold pt-1 border-t">
                          <span>Balance</span>
                          <span className={balance > 0 ? 'text-red-600' : 'text-green-600'}>{formatPKR(balance)}</span>
                        </div>
                      </div>
                    )}

                    {/* Payment form */}
                    {payingInvoiceId === inv.id ? (
                      <div className="border rounded-lg p-3 space-y-2 bg-blue-50">
                        <p className="text-xs font-medium text-blue-800">Record Payment (Balance: {formatPKR(balance)})</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="number" step="0.01" placeholder={String(balance)} className="h-8 text-sm"
                            value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
                          <Input type="date" className="h-8 text-sm"
                            value={paymentForm.paymentDate} onChange={e => setPaymentForm(f => ({ ...f, paymentDate: e.target.value }))} />
                          <Select value={paymentForm.method} onValueChange={v => setPaymentForm(f => ({ ...f, method: v ?? 'CASH' }))}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CASH">Cash</SelectItem>
                              <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                              <SelectItem value="CHEQUE">Cheque</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input className="h-8 text-sm" placeholder="Reference #"
                            value={paymentForm.reference} onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))} />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => recordPayment(inv.id)} disabled={savingPayment}>
                            {savingPayment ? 'Saving...' : 'Record'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setPayingInvoiceId(null); setPaymentForm(emptyPayment) }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      inv.status !== 'PAID' && (
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => setPayingInvoiceId(inv.id)}>
                          <Plus size={12} /> Record Payment
                        </Button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Return Invoices */}
      {supplier.supplierReturns.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Return Invoices ({supplier.supplierReturns.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {supplier.supplierReturns.map(ret => (
                <div key={ret.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono font-medium text-sm">{ret.returnNumber}</p>
                      <p className="text-xs text-slate-500">{formatDate(ret.returnDate)} · {ret.items.length} items</p>
                    </div>
                    <p className="font-bold text-orange-600">-{formatPKR(ret.totalAmount)}</p>
                  </div>
                  <div className="bg-slate-50 rounded p-2 space-y-1">
                    {ret.items.map(item => (
                      <div key={item.id} className="flex justify-between text-xs text-slate-600">
                        <span>{item.medicine.name}{item.reason && <span className="text-slate-400"> — {item.reason}</span>}</span>
                        <span>{item.quantity} × {formatPKR(item.purchasePrice)} = {formatPKR(item.lineTotal)}</span>
                      </div>
                    ))}
                  </div>
                  {ret.notes && <p className="text-xs text-slate-500 italic">{ret.notes}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
