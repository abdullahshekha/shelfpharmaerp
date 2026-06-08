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
import { ArrowLeft, Plus, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface PurchaseInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string | null
  totalAmount: number
  status: string
  notes: string | null
  supplier: { id: string; name: string; type: string; phone: string | null }
  items: {
    id: string; quantity: number; unitPrice: number; lineTotal: number
    medicine: { name: string; code: string; category: string | null }
  }[]
  payments: { id: string; amount: number; paymentDate: string; method: string; reference: string | null }[]
}

const STATUS_COLORS: Record<string, string> = {
  UNPAID:  'bg-red-100 text-red-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID:    'bg-green-100 text-green-700',
}

const emptyPayment = { amount: '', method: 'CASH', reference: '', paymentDate: new Date().toISOString().slice(0, 10) }

export default function PurchaseInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState(emptyPayment)
  const [savingPayment, setSavingPayment] = useState(false)

  const fetchInvoice = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/purchase-invoices/${id}`)
    const j = await res.json()
    setInvoice(j.data)
    setLoading(false)
  }, [id])

  useEffect(() => { fetchInvoice() }, [fetchInvoice])

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
            <div className="flex justify-between">
              <span className="text-slate-500">Invoice Total</span>
              <span className="font-semibold">{formatPKR(invoice.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
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
        <CardHeader><CardTitle className="text-base">Items ({invoice.items.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Medicine</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">Qty</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Unit Price</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, i) => (
                <tr key={item.id} className={`border-b ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{item.medicine.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{item.medicine.code}</p>
                  </td>
                  <td className="px-4 py-2.5 text-center">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-right">{formatPKR(item.unitPrice)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatPKR(item.lineTotal)}</td>
                </tr>
              ))}
              <tr className="font-bold border-t">
                <td colSpan={3} className="px-4 py-3 text-right">Total</td>
                <td className="px-4 py-3 text-right text-base">{formatPKR(invoice.totalAmount)}</td>
              </tr>
            </tbody>
          </table>
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
