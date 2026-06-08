'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ArrowLeft, Printer, Trash2, Plus, X, Download } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  UNPAID: 'bg-red-100 text-red-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-200 text-red-800',
}

interface Payment { id: string; amount: number; paymentDate: string; method: string; reference?: string }

interface Invoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string | null
  subtotal: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
  status: string
  notes: string | null
  retailer: { name: string; ownerName: string | null; phone: string | null; area: string | null; address: string | null; drugLicenseNumber: string | null }
  order: { orderNumber: string; items: { id: string; quantity: number; unitPrice: number; offerPercent: number; lineTotal: number; medicine: { name: string; code: string } }[] }
  payments: Payment[]
}

const emptyPayment = { amount: '', method: 'CASH', reference: '', paymentDate: new Date().toISOString().slice(0, 10) }

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState(emptyPayment)
  const [savingPayment, setSavingPayment] = useState(false)

  const fetchInvoice = useCallback(() => {
    fetch(`/api/invoices/${id}`)
      .then(r => r.json())
      .then(j => setInvoice(j.data))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { fetchInvoice() }, [fetchInvoice])

  const voidInvoice = async () => {
    if (!confirm('Void this invoice?')) return
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'DRAFT' }),
    })
    if (res.ok) { toast.success('Invoice voided'); router.push('/invoices') }
    else toast.error('Failed to void invoice')
  }

  const recordPayment = async () => {
    if (!paymentForm.amount || Number(paymentForm.amount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setSavingPayment(true)
    const res = await fetch(`/api/invoices/${id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentForm),
    })
    if (res.ok) {
      const j = await res.json()
      toast.success(`Payment recorded · Invoice now ${j.data.newStatus}`)
      setShowPaymentForm(false)
      setPaymentForm(emptyPayment)
      fetchInvoice()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to record payment')
    }
    setSavingPayment(false)
  }

  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading...</div>
  if (!invoice) return <div className="p-8 text-slate-400">Invoice not found.</div>

  const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0)
  const balance = Number(invoice.totalAmount) - totalPaid

  return (
    <div className="space-y-6 max-w-4xl" id="invoice-print">
      <div className="flex items-center gap-3 print:hidden">
        <Link href="/invoices"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <h1 className="text-2xl font-bold flex-1">Invoice</h1>
        <Badge className={STATUS_COLORS[invoice.status] ?? ''}>{invoice.status}</Badge>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
          <Printer size={14} /> Print
        </Button>
        <a
          href={`/api/invoices/${id}/pdf`}
          download
          className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
        >
          <Download size={14} /> Download PDF
        </a>
        {invoice.status !== 'PAID' && (
          <>
            <Button size="sm" className="gap-2" onClick={() => setShowPaymentForm(true)}>
              <Plus size={14} /> Record Payment
            </Button>
            <Button variant="outline" size="sm" className="gap-2 text-red-600 border-red-200 hover:bg-red-50" onClick={voidInvoice}>
              <Trash2 size={14} /> Void
            </Button>
          </>
        )}
      </div>

      {/* Payment Form */}
      {showPaymentForm && (
        <Card className="border-blue-200 bg-blue-50 print:hidden">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium text-blue-900">Record Payment</p>
              <button onClick={() => { setShowPaymentForm(false); setPaymentForm(emptyPayment) }}>
                <X size={16} className="text-slate-400" />
              </button>
            </div>
            <p className="text-sm text-blue-700">
              Balance due: <strong>{formatPKR(balance)}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Amount (PKR) *</Label>
                <Input
                  type="number" step="0.01" placeholder={String(balance)}
                  className="h-8 text-sm"
                  value={paymentForm.amount}
                  onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date" className="h-8 text-sm"
                  value={paymentForm.paymentDate}
                  onChange={e => setPaymentForm(f => ({ ...f, paymentDate: e.target.value }))}
                />
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
                <Input
                  placeholder="Optional"
                  className="h-8 text-sm"
                  value={paymentForm.reference}
                  onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { setShowPaymentForm(false); setPaymentForm(emptyPayment) }}>Cancel</Button>
              <Button size="sm" onClick={recordPayment} disabled={savingPayment}>
                {savingPayment ? 'Saving...' : 'Record Payment'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invoice Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Shelf Pharma</h2>
              <p className="text-slate-500 text-sm">PECHS Ext. Block 6, Karachi</p>
              <p className="text-slate-500 text-sm">WhatsApp: 0330-7774353</p>
            </div>
            <div className="text-right">
              <p className="font-mono font-bold text-lg">{invoice.invoiceNumber}</p>
              <p className="text-sm text-slate-500">Date: {formatDate(invoice.invoiceDate)}</p>
              {invoice.dueDate && <p className="text-sm text-slate-500">Due: {formatDate(invoice.dueDate)}</p>}
            </div>
          </div>
          <div className="mt-6 pt-4 border-t">
            <p className="text-sm font-medium text-slate-600 mb-1">Bill To:</p>
            <p className="font-semibold">{invoice.retailer.name}</p>
            {invoice.retailer.ownerName && <p className="text-sm text-slate-600">{invoice.retailer.ownerName}</p>}
            {invoice.retailer.area && <p className="text-sm text-slate-500">{invoice.retailer.area}</p>}
            {invoice.retailer.address && <p className="text-sm text-slate-500">{invoice.retailer.address}</p>}
            {invoice.retailer.phone && <p className="text-sm text-slate-500">Tel: {invoice.retailer.phone}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Medicine</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">Qty</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Unit Price</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">Offer</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.order.items.map(item => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-2">
                    <div className="font-medium">{item.medicine.name}</div>
                    <div className="text-xs text-slate-400 font-mono">{item.medicine.code}</div>
                  </td>
                  <td className="px-4 py-2 text-center">{item.quantity}</td>
                  <td className="px-4 py-2 text-right">{formatPKR(item.unitPrice)}</td>
                  <td className="px-4 py-2 text-center">{Number(item.offerPercent) > 0 ? `${item.offerPercent}%` : '—'}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatPKR(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td colSpan={4} className="px-4 py-2 text-right text-slate-600">Subtotal</td>
                <td className="px-4 py-2 text-right">{formatPKR(invoice.subtotal)}</td>
              </tr>
              {Number(invoice.discountAmount) > 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-right text-slate-600">Discount</td>
                  <td className="px-4 py-2 text-right text-red-600">-{formatPKR(invoice.discountAmount)}</td>
                </tr>
              )}
              <tr className="font-bold">
                <td colSpan={4} className="px-4 py-3 text-right">Total</td>
                <td className="px-4 py-3 text-right text-lg">{formatPKR(invoice.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* Payments & Balance */}
      <Card>
        <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {invoice.payments.length === 0 ? (
            <p className="text-slate-400">No payments recorded yet.</p>
          ) : (
            invoice.payments.map(p => (
              <div key={p.id} className="flex justify-between">
                <span className="text-slate-600">{formatDate(p.paymentDate)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                <span className="font-medium text-green-700">+{formatPKR(p.amount)}</span>
              </div>
            ))
          )}
          <div className="pt-2 border-t flex justify-between font-semibold">
            <span>Balance Due</span>
            <span className={balance > 0 ? 'text-red-600 text-lg' : 'text-green-700 text-lg'}>{formatPKR(balance)}</span>
          </div>
        </CardContent>
      </Card>

      {invoice.notes && (
        <Card><CardContent className="pt-4 text-sm text-slate-600">
          <span className="font-medium">Notes:</span> {invoice.notes}
        </CardContent></Card>
      )}
    </div>
  )
}
