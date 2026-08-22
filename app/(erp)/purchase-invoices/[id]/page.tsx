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
import { calcPurchasePercent } from '@/lib/utils/pricing'
import { ArrowLeft, Plus, ExternalLink, Download, Pencil, X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

interface PurchaseInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string | null
  totalAmount: number
  salesTaxTotal: number
  aitCollectibleTotal: number
  aitPayableTotal: number
  previousPayable: number
  grandTotal: number
  status: string
  notes: string | null
  supplier: { id: string; name: string; type: string; phone: string | null; isFiler: boolean }
  items: {
    id: string
    quantity: number
    bonusQuantity: number
    batchNumber: string
    expiryDate: string
    tradePrice: number
    mrp: number | null
    discountPercent: number
    tradeOfferPercent: number
    salesTax: number
    salesTaxAmount: number
    aitCollectiblePercent: number
    aitPayablePercent: number
    aitCollectibleAmount: number
    aitPayableAmount: number
    purchasePrice: number
    lineTotal: number
    medicine: { name: string; code: string; category: string | null; salesTaxApplicable?: boolean }
  }[]
  payments: { id: string; amount: number; paymentDate: string; method: string; reference: string | null }[]
}

const STATUS_COLORS: Record<string, string> = {
  UNPAID:  'bg-red-100 text-red-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID:    'bg-green-100 text-green-700',
}

const emptyPayment = { amount: '', method: 'CASH', reference: '', paymentDate: new Date().toISOString().slice(0, 10) }

type EditableItem = PurchaseInvoice['items'][number] & { mrpInput: string }

export default function PurchaseInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useCurrentUser()
  const isAdmin = user?.role === 'ADMIN'
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState(emptyPayment)
  const [savingPayment, setSavingPayment] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editItems, setEditItems] = useState<EditableItem[]>([])
  const [saving, setSaving] = useState(false)

  const fetchInvoice = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/purchase-invoices/${id}`)
    const j = await res.json()
    setInvoice(j.data)
    setLoading(false)
  }, [id])

  useEffect(() => { fetchInvoice() }, [fetchInvoice])

  const startEdit = () => {
    if (!invoice) return
    setEditItems(invoice.items.map(i => ({ ...i, mrpInput: i.mrp != null ? String(i.mrp) : '' })))
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setEditItems([]) }

  const updateEditItem = (itemId: string, patch: Partial<EditableItem>) => {
    setEditItems(prev => prev.map(i => (i.id === itemId ? { ...i, ...patch } : i)))
  }

  const saveEdit = async () => {
    setSaving(true)
    const res = await fetch(`/api/purchase-invoices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: editItems.map(i => ({
          id: i.id,
          batchNumber: i.batchNumber,
          expiryDate: i.expiryDate,
          quantity: i.quantity,
          bonusQuantity: i.bonusQuantity,
          tradePrice: i.tradePrice,
          mrp: i.mrpInput === '' ? null : parseFloat(i.mrpInput),
          discountPercent: i.discountPercent,
          salesTax: i.salesTax,
          aitCollectiblePercent: i.aitCollectiblePercent,
          aitPayablePercent: i.aitPayablePercent,
        })),
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      toast.success('Purchase invoice updated')
      if (j.warnings?.length) j.warnings.forEach((w: string) => toast.warning(w))
      setEditing(false)
      fetchInvoice()
    } else {
      toast.error(j.error ?? 'Failed to save changes')
    }
    setSaving(false)
  }

  const recordPayment = async () => {
    if (!paymentForm.amount || Number(paymentForm.amount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setSavingPayment(true)
    const res = await fetch(`/api/purchase-invoices/${id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentForm),
    })
    if (res.ok) {
      const j = await res.json()
      toast.success(`Payment recorded · Invoice now ${j.newStatus}`)
      setShowPaymentForm(false)
      setPaymentForm(emptyPayment)
      fetchInvoice()
    } else {
      toast.error('Failed to record payment')
    }
    setSavingPayment(false)
  }

  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading…</div>
  if (!invoice) return <div className="p-8 text-slate-400">Invoice not found.</div>

  const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0)
  const balance = Number(invoice.totalAmount) - totalPaid

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/purchase-invoices"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold font-mono">{invoice.invoiceNumber}</h1>
          <p className="text-slate-500 text-sm">{formatDate(invoice.invoiceDate)}</p>
        </div>
        <Badge className={`${STATUS_COLORS[invoice.status] ?? ''}`}>{invoice.status}</Badge>
        <a
          href={`/api/purchase-invoices/${id}/pdf`}
          download
          className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
        >
          <Download size={14} /> Download PDF
        </a>
        {isAdmin && !editing && (
          <Button size="sm" variant="outline" className="gap-1" onClick={startEdit}>
            <Pencil size={14} /> Edit
          </Button>
        )}
        {invoice.status !== 'PAID' && (
          <Button size="sm" className="gap-1" onClick={() => setShowPaymentForm(true)}>
            <Plus size={14} /> Record Payment
          </Button>
        )}
      </div>

      {/* Supplier + invoice info */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Supplier</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-900">{invoice.supplier.name}</p>
              <Link href={`/suppliers/${invoice.supplier.id}`} className="text-blue-500 hover:text-blue-700">
                <ExternalLink size={13} />
              </Link>
            </div>
            <p className="text-slate-500 text-xs">
              {invoice.supplier.type === 'OFFICIAL_DISTRIBUTOR' ? 'Official Distributor' : 'Open Market'}
            </p>
            {invoice.supplier.phone && <p className="text-slate-500 text-xs">{invoice.supplier.phone}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Total (exc. taxes)</span>
              <span>{formatPKR(invoice.items.reduce((s, item) => s + Number(item.lineTotal), 0))}</span>
            </div>
            {Number(invoice.salesTaxTotal) > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Total Sales Tax</span>
                <span>{formatPKR(invoice.salesTaxTotal)}</span>
              </div>
            )}
            {Number(invoice.aitCollectibleTotal) > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Adv Tax Collectible</span>
                <span className="text-red-600">-{formatPKR(invoice.aitCollectibleTotal)}</span>
              </div>
            )}
            {Number(invoice.aitPayableTotal) > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Adv Tax Payable</span>
                <span>{formatPKR(invoice.aitPayableTotal)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 mt-1">
              <span className="font-semibold">Invoice Total</span>
              <span className="font-semibold">{formatPKR(invoice.totalAmount)}</span>
            </div>
            {Number(invoice.previousPayable) > 0 && (
              <>
                <div className="flex justify-between text-slate-500">
                  <span>Previous Payable</span>
                  <span>{formatPKR(invoice.previousPayable)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 mt-1">
                  <span className="font-bold">Grand Total</span>
                  <span className="font-bold">{formatPKR(invoice.grandTotal)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between pt-1">
              <span className="text-slate-500">Total Paid</span>
              <span className="text-green-600 font-medium">{formatPKR(totalPaid)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 mt-1">
              <span className="font-semibold">Balance Due</span>
              <span className={`font-bold text-base ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {balance <= 0 ? 'Paid in Full' : formatPKR(balance)}
              </span>
            </div>
            {invoice.dueDate && (
              <p className="text-xs text-slate-400 pt-1">Due: {formatDate(invoice.dueDate)}</p>
            )}
            {invoice.notes && (
              <p className="text-xs text-slate-500 pt-1 italic">{invoice.notes}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment form */}
      {showPaymentForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 space-y-3">
            <p className="font-medium text-blue-900 text-sm">
              Record Payment — Balance: <strong>{formatPKR(balance)}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Amount (PKR) *</Label>
                <Input type="number" step="0.01" placeholder={String(balance)} className="h-8 text-sm"
                  value={paymentForm.amount}
                  onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input type="date" className="h-8 text-sm"
                  value={paymentForm.paymentDate}
                  onChange={e => setPaymentForm(f => ({ ...f, paymentDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Method</Label>
                <Select value={paymentForm.method} onValueChange={v => setPaymentForm(f => ({ ...f, method: v ?? 'CASH' }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                    <SelectItem value="CHEQUE">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reference / Cheque #</Label>
                <Input className="h-8 text-sm" placeholder="Optional"
                  value={paymentForm.reference}
                  onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline"
                onClick={() => { setShowPaymentForm(false); setPaymentForm(emptyPayment) }}>
                Cancel
              </Button>
              <Button size="sm" onClick={recordPayment} disabled={savingPayment}>
                {savingPayment ? 'Saving…' : 'Record Payment'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Line items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Items ({invoice.items.length})</CardTitle>
          {editing && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={cancelEdit} disabled={saving}>
                <X size={14} /> Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1050px]">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Medicine</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Batch #</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Expiry</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Qty</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Bonus</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">MRP</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Trade Price</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Disc %</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Purchase %</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">S. Tax</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Adv Tax-C %</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Adv Tax-P %</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Purchase Price</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Total</th>
                </tr>
              </thead>
              <tbody>
                {editing ? editItems.map((item, i) => {
                  const totalQty = item.quantity + item.bonusQuantity
                  const tradeOfferPercent = totalQty > 0 && item.bonusQuantity > 0 ? (item.bonusQuantity / totalQty) * 100 : 0
                  const purchasePercent = calcPurchasePercent(Number(item.discountPercent), tradeOfferPercent)
                  const purchasePrice = item.tradePrice * (1 - purchasePercent / 100)
                  return (
                    <tr key={item.id} className={`border-b ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-4 py-2">
                        <p className="font-medium whitespace-nowrap">{item.medicine.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{item.medicine.code}</p>
                      </td>
                      <td className="px-2 py-2"><Input className="w-24 h-8 text-xs" value={item.batchNumber}
                        onChange={e => updateEditItem(item.id, { batchNumber: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input type="date" className="w-32 h-8 text-xs" value={item.expiryDate.slice(0, 10)}
                        onChange={e => updateEditItem(item.id, { expiryDate: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input type="number" min="1" className="w-16 h-8 text-xs text-center" value={item.quantity}
                        onChange={e => updateEditItem(item.id, { quantity: parseInt(e.target.value) || 1 })} /></td>
                      <td className="px-2 py-2"><Input type="number" min="0" className="w-16 h-8 text-xs text-center" value={item.bonusQuantity}
                        onChange={e => updateEditItem(item.id, { bonusQuantity: parseInt(e.target.value) || 0 })} /></td>
                      <td className="px-2 py-2"><Input type="number" step="0.01" className="w-20 h-8 text-xs text-right" value={item.mrpInput}
                        onChange={e => updateEditItem(item.id, { mrpInput: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input type="number" step="0.01" className="w-24 h-8 text-xs text-right" value={item.tradePrice}
                        onChange={e => updateEditItem(item.id, { tradePrice: parseFloat(e.target.value) || 0 })} /></td>
                      <td className="px-2 py-2"><Input type="number" min="0" max="100" step="0.01" className="w-16 h-8 text-xs text-right" value={item.discountPercent}
                        onChange={e => updateEditItem(item.id, { discountPercent: parseFloat(e.target.value) || 0 })} /></td>
                      <td className="px-4 py-2 text-right">{purchasePercent.toFixed(2)}%</td>
                      <td className="px-2 py-2">
                        {item.medicine.salesTaxApplicable ? (
                          <Input type="number" min="0" step="0.01" className="w-20 h-8 text-xs text-right" value={item.salesTax}
                            onChange={e => updateEditItem(item.id, { salesTax: parseFloat(e.target.value) || 0 })} />
                        ) : <span className="text-slate-300 text-xs block text-right pr-1">N/A</span>}
                      </td>
                      <td className="px-2 py-2">
                        {invoice.supplier.isFiler ? (
                          <Input type="number" min="0" max="100" step="0.01" className="w-16 h-8 text-xs text-right" value={item.aitCollectiblePercent}
                            onChange={e => updateEditItem(item.id, { aitCollectiblePercent: parseFloat(e.target.value) || 0 })} />
                        ) : <span className="text-slate-300 text-xs block text-right pr-1">—</span>}
                      </td>
                      <td className="px-2 py-2">
                        {invoice.supplier.isFiler ? (
                          <Input type="number" min="0" max="100" step="0.01" className="w-16 h-8 text-xs text-right" value={item.aitPayablePercent}
                            onChange={e => updateEditItem(item.id, { aitPayablePercent: parseFloat(e.target.value) || 0 })} />
                        ) : <span className="text-slate-300 text-xs block text-right pr-1">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right">{formatPKR(purchasePrice)}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatPKR(purchasePrice * totalQty)}</td>
                    </tr>
                  )
                }) : invoice.items.map((item, i) => (
                  <tr key={item.id} className={`border-b ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium whitespace-nowrap">{item.medicine.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{item.medicine.code}</p>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{item.batchNumber}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(item.expiryDate)}</td>
                    <td className="px-4 py-2.5 text-center">{item.quantity}</td>
                    <td className="px-4 py-2.5 text-center">{item.bonusQuantity > 0 ? item.bonusQuantity : '—'}</td>
                    <td className="px-4 py-2.5 text-right">{item.mrp != null ? formatPKR(item.mrp) : '—'}</td>
                    <td className="px-4 py-2.5 text-right">{formatPKR(item.tradePrice)}</td>
                    <td className="px-4 py-2.5 text-right">{Number(item.discountPercent)}%</td>
                    <td className="px-4 py-2.5 text-right">{calcPurchasePercent(Number(item.discountPercent), Number(item.tradeOfferPercent)).toFixed(2)}%</td>
                    <td className="px-4 py-2.5 text-right">{formatPKR(item.salesTax)}</td>
                    <td className="px-4 py-2.5 text-right">{Number(item.aitCollectiblePercent)}%</td>
                    <td className="px-4 py-2.5 text-right">{Number(item.aitPayablePercent)}%</td>
                    <td className="px-4 py-2.5 text-right">{formatPKR(item.purchasePrice)}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{formatPKR(item.lineTotal)}</td>
                  </tr>
                ))}
                <tr className="font-bold border-t">
                  <td colSpan={13} className="px-4 py-3 text-right">Total (exc. taxes)</td>
                  <td className="px-4 py-3 text-right text-base">
                    {formatPKR(invoice.items.reduce((s, item) => s + Number(item.lineTotal), 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Payment history */}
      {invoice.payments.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {invoice.payments.map(p => (
              <div key={p.id} className="flex justify-between items-center py-1 border-b last:border-0">
                <span className="text-slate-600">
                  {formatDate(p.paymentDate)} · {p.method}
                  {p.reference && <span className="text-slate-400"> · {p.reference}</span>}
                </span>
                <span className="font-medium text-green-700">+{formatPKR(p.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
