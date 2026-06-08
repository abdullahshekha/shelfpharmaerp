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
import { ArrowLeft, Plus, X, Search } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface Medicine { id: string; name: string; code: string; tradePrice: number }
interface InvoiceItem { medicineId: string; medicineName: string; quantity: number; unitPrice: number }
interface Payment { id: string; amount: number; paymentDate: string; method: string; reference: string | null }

interface PurchaseInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  totalAmount: number
  status: string
  notes: string | null
  items: { id: string; quantity: number; unitPrice: number; lineTotal: number; medicine: { name: string; code: string } }[]
  payments: Payment[]
}

interface Supplier {
  id: string; name: string; type: string; contactPerson: string | null
  phone: string | null; address: string | null; notes: string | null
  purchaseInvoices: PurchaseInvoice[]
}

const STATUS_COLORS: Record<string, string> = {
  UNPAID: 'bg-red-100 text-red-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID: 'bg-green-100 text-green-700',
}

const emptyPayment = { amount: '', method: 'CASH', reference: '', paymentDate: new Date().toISOString().slice(0, 10) }

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)

  // New invoice form
  const [showInvoiceForm, setShowInvoiceForm] = useState(false)
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [medSearch, setMedSearch] = useState('')
  const [medResults, setMedResults] = useState<Medicine[]>([])
  const [showMedDrop, setShowMedDrop] = useState(false)
  const [savingInvoice, setSavingInvoice] = useState(false)

  // Payment form
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null)
  const [paymentForm, setPaymentForm] = useState(emptyPayment)
  const [savingPayment, setSavingPayment] = useState(false)

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

  const addItem = (med: Medicine) => {
    const existing = items.find(i => i.medicineId === med.id)
    if (existing) {
      setItems(prev => prev.map(i => i.medicineId === med.id ? { ...i, quantity: i.quantity + 1 } : i))
    } else {
      setItems(prev => [...prev, { medicineId: med.id, medicineName: med.name, quantity: 1, unitPrice: med.tradePrice }])
    }
    setMedSearch('')
    setShowMedDrop(false)
  }

  const createInvoice = async () => {
    if (items.length === 0) { toast.error('Add at least one medicine'); return }
    setSavingInvoice(true)
    const res = await fetch('/api/purchase-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId: id,
        invoiceDate,
        notes: invoiceNotes || null,
        items: items.map(i => ({ medicineId: i.medicineId, quantity: i.quantity, unitPrice: i.unitPrice })),
      }),
    })
    if (res.ok) {
      toast.success('Purchase invoice created')
      setShowInvoiceForm(false)
      setItems([])
      setInvoiceNotes('')
      fetchSupplier()
    } else {
      toast.error('Failed to create invoice')
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

  const invoiceTotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)

  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading...</div>
  if (!supplier) return <div className="p-8 text-slate-400">Supplier not found.</div>

  const totalOwed = supplier.purchaseInvoices
    .filter(i => i.status !== 'PAID')
    .reduce((s, i) => s + Number(i.totalAmount), 0)

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/suppliers"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{supplier.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge className={supplier.type === 'OFFICIAL_DISTRIBUTOR' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}>
              {supplier.type === 'OFFICIAL_DISTRIBUTOR' ? 'Official Distributor' : 'Open Market'}
            </Badge>
            {totalOwed > 0 && (
              <span className="text-sm text-red-600 font-medium">Outstanding: {formatPKR(totalOwed)}</span>
            )}
          </div>
        </div>
        <Button onClick={() => setShowInvoiceForm(true)} className="gap-2">
          <Plus size={16} /> New Purchase Invoice
        </Button>
      </div>

      {/* Supplier info */}
      <div className="grid sm:grid-cols-3 gap-3 text-sm text-slate-600">
        {supplier.contactPerson && <div><span className="text-slate-400">Contact:</span> {supplier.contactPerson}</div>}
        {supplier.phone && <div><span className="text-slate-400">Phone:</span> {supplier.phone}</div>}
        {supplier.address && <div><span className="text-slate-400">Address:</span> {supplier.address}</div>}
      </div>

      {/* New invoice form */}
      {showInvoiceForm && (
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              New Purchase Invoice
              <button onClick={() => { setShowInvoiceForm(false); setItems([]) }}><X size={16} className="text-slate-400" /></button>
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

            {/* Medicine search */}
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

            {/* Items table */}
            {items.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-slate-600 text-xs">
                    <th className="text-left py-1.5">Medicine</th>
                    <th className="text-center py-1.5 w-20">Qty</th>
                    <th className="text-right py-1.5 w-28">Unit Price</th>
                    <th className="text-right py-1.5 w-24">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.medicineId} className="border-b">
                      <td className="py-1.5 font-medium">{item.medicineName}</td>
                      <td className="py-1.5 text-center">
                        <Input type="number" min="1" className="w-16 h-7 text-xs text-center mx-auto"
                          value={item.quantity}
                          onChange={e => setItems(prev => prev.map(i => i.medicineId === item.medicineId
                            ? { ...i, quantity: parseInt(e.target.value) || 1 } : i))} />
                      </td>
                      <td className="py-1.5 text-right">
                        <Input type="number" step="0.01" className="w-24 h-7 text-xs text-right ml-auto"
                          value={item.unitPrice}
                          onChange={e => setItems(prev => prev.map(i => i.medicineId === item.medicineId
                            ? { ...i, unitPrice: parseFloat(e.target.value) || 0 } : i))} />
                      </td>
                      <td className="py-1.5 text-right text-xs font-medium">{formatPKR(item.quantity * item.unitPrice)}</td>
                      <td className="py-1.5">
                        <button className="text-slate-400 hover:text-red-500"
                          onClick={() => setItems(prev => prev.filter(i => i.medicineId !== item.medicineId))}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="py-2 text-right font-semibold">Total</td>
                    <td className="py-2 text-right font-bold">{formatPKR(invoiceTotal)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowInvoiceForm(false); setItems([]) }}>Cancel</Button>
              <Button size="sm" onClick={createInvoice} disabled={savingInvoice || items.length === 0}>
                {savingInvoice ? 'Creating...' : `Create Invoice (${formatPKR(invoiceTotal)})`}
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
                          <span>{item.medicine.name}</span>
                          <span>{item.quantity} × {formatPKR(item.unitPrice)} = {formatPKR(item.lineTotal)}</span>
                        </div>
                      ))}
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
    </div>
  )
}
