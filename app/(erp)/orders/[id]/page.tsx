'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPKR, formatDate, formatDateTime } from '@/lib/utils/format'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Trash2, Pencil, X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'PICKING', 'DISPATCHED', 'DELIVERED']
const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  PICKING: 'bg-yellow-100 text-yellow-700',
  DISPATCHED: 'bg-orange-100 text-orange-700',
  DELIVERED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
}

interface OrderItem {
  id: string
  quantity: number
  mrp: number | null
  unitPrice: number
  offerPercent: number
  salesTax: number
  bonusQty: number
  lineTotal: number
  medicine: { name: string; code: string; category: string | null; salesTaxApplicable?: boolean }
}

interface Order {
  id: string
  orderNumber: string
  orderDate: string
  status: string
  source: string
  totalAmount: number
  discountAmount: number
  notes: string | null
  retailer: { id: string; name: string; area: { name: string } | null; phone: string | null }
  salesRep: { name: string } | null
  items: OrderItem[]
  invoice: { id: string; invoiceNumber: string; status: string } | null
  delivery: { scheduledDate: string; status: string; driver: { name: string } | null } | null
  whatsappOrder: { imageUrl: string } | null
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useCurrentUser()
  const isAdmin = user?.role === 'ADMIN'
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editItems, setEditItems] = useState<OrderItem[]>([])
  const [saving, setSaving] = useState(false)

  const fetchOrder = async () => {
    const res = await fetch(`/api/orders/${id}`)
    const j = await res.json()
    setOrder(j.data)
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchOrder() }, [id])

  const startEdit = () => {
    if (!order) return
    setEditItems(order.items.map(i => ({ ...i })))
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setEditItems([]) }

  const updateEditItem = (itemId: string, patch: Partial<OrderItem>) => {
    setEditItems(prev => prev.map(i => (i.id === itemId ? { ...i, ...patch } : i)))
  }

  const saveEdit = async () => {
    setSaving(true)
    const res = await fetch(`/api/orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: editItems.map(i => ({
          id: i.id,
          quantity: i.quantity,
          mrp: i.mrp,
          unitPrice: i.unitPrice,
          offerPercent: i.offerPercent,
          salesTax: i.salesTax,
          bonusQty: i.bonusQty,
        })),
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      toast.success('Sales invoice updated')
      if (j.warnings?.length) j.warnings.forEach((w: string) => toast.warning(w))
      setEditing(false)
      fetchOrder()
    } else {
      toast.error(j.error ?? 'Failed to save changes')
    }
    setSaving(false)
  }

  const advanceStatus = async () => {
    if (!order) return
    const idx = STATUS_FLOW.indexOf(order.status)
    if (idx === -1 || idx >= STATUS_FLOW.length - 1) return
    const next = STATUS_FLOW[idx + 1]
    setUpdating(true)
    const res = await fetch(`/api/orders/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    if (res.ok) {
      toast.success(`Order moved to ${next}`)
      fetchOrder()
    } else {
      toast.error('Failed to update status')
    }
    setUpdating(false)
  }

  const cancelOrder = async () => {
    if (!confirm('Cancel this order?')) return
    setUpdating(true)
    const res = await fetch(`/api/orders/${id}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      if (j.pending) toast.info(j.message)
      else toast.success('Order cancelled')
      if (j.warnings?.length) j.warnings.forEach((w: string) => toast.warning(w))
      fetchOrder()
    } else {
      toast.error(j.error ?? 'Failed to cancel order')
    }
    setUpdating(false)
  }

  const deleteOrder = async () => {
    const deliveredOrPaid = order?.status === 'DELIVERED' || order?.invoice?.status === 'PAID'
    const msg = deliveredOrPaid
      ? 'This order has been delivered or paid. Deleting it will also delete the invoice and payments. Are you sure?'
      : 'Permanently delete this order? This will also remove the linked invoice and delivery.'
    if (!confirm(msg)) return
    setUpdating(true)
    const res = await fetch(`/api/orders/${id}?hard=true`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      if (j.pending) { toast.info(j.message); setUpdating(false); return }
      toast.success('Order deleted')
      if (j.warnings?.length) j.warnings.forEach((w: string) => toast.warning(w))
      router.push('/orders')
    } else {
      toast.error(j.error ?? 'Failed to delete order')
      setUpdating(false)
    }
  }

  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading...</div>
  if (!order) return <div className="p-8 text-slate-400">Order not found.</div>

  const currentIdx = STATUS_FLOW.indexOf(order.status)
  const canAdvance = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/orders"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono">{order.orderNumber}</h1>
            <Badge className={STATUS_COLORS[order.status] ?? ''}>{order.status}</Badge>
          </div>
          <p className="text-slate-500 text-sm">{formatDateTime(order.orderDate)}</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && !editing && (
            <Button variant="outline" className="gap-1" onClick={startEdit} disabled={updating}>
              <Pencil size={14} /> Edit
            </Button>
          )}
          {canAdvance && order.status !== 'CANCELLED' && (
            <Button onClick={advanceStatus} disabled={updating}>
              → {STATUS_FLOW[currentIdx + 1]}
            </Button>
          )}
          {order.status === 'PENDING' && (
            <Button variant="outline" onClick={cancelOrder} disabled={updating}
              className="text-red-600 border-red-200 hover:bg-red-50">
              Cancel
            </Button>
          )}
          <Button variant="outline" onClick={deleteOrder} disabled={updating}
            className="text-red-700 border-red-300 hover:bg-red-50 gap-1">
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </div>

      {/* Status Timeline */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-0">
            {STATUS_FLOW.map((s, i) => {
              const done = STATUS_FLOW.indexOf(order.status) >= i
              const active = order.status === s
              return (
                <div key={s} className="flex items-center flex-1">
                  <div className={`flex flex-col items-center flex-1 ${i === 0 ? '' : ''}`}>
                    <div className={`h-2 w-full ${i === 0 ? 'rounded-l-full' : i === STATUS_FLOW.length - 1 ? 'rounded-r-full' : ''} ${done ? 'bg-blue-500' : 'bg-slate-200'}`} />
                    <span className={`text-xs mt-1 ${active ? 'font-bold text-blue-600' : done ? 'text-blue-500' : 'text-slate-400'}`}>
                      {s}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Customer</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <Link href={`/retailers/${order.retailer.id}`} className="font-medium text-blue-600 hover:underline">
              {order.retailer.name}
            </Link>
            {order.retailer.area && <p className="text-slate-500">{order.retailer.area.name}</p>}
            {order.retailer.phone && <p className="text-slate-500">{order.retailer.phone}</p>}
            {order.salesRep && <p className="text-slate-500">Rep: {order.salesRep.name}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Delivery & Invoice</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            {order.delivery && (
              <div>
                <p className="font-medium">Delivery: {formatDate(order.delivery.scheduledDate)}</p>
                <Badge className="text-xs mt-1">{order.delivery.status}</Badge>
                {order.delivery.driver && <p className="text-slate-500">Driver: {order.delivery.driver.name}</p>}
              </div>
            )}
            {order.invoice && (
              <div>
                <Link href={`/invoices/${order.invoice.id}`} className="font-medium text-blue-600 hover:underline">
                  {order.invoice.invoiceNumber}
                </Link>
                <Badge className="text-xs ml-2">{order.invoice.status}</Badge>
              </div>
            )}
            {order.status !== 'PENDING' && order.status !== 'CANCELLED' && (
              <a href={`/api/orders/${order.id}/challan`} download className="text-blue-600 hover:underline block">
                Download Delivery Challan
              </a>
            )}
            {!order.delivery && !order.invoice && (
              <p className="text-slate-400">Will be created on CONFIRMED</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Order Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              Items ({order.items.length})
              {editing && (
                <span className="flex gap-2 ml-2">
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={cancelEdit} disabled={saving}>
                    <X size={12} /> Cancel
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={saveEdit} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </Button>
                </span>
              )}
            </span>
            <span className="font-bold text-lg">
              {formatPKR(editing ? editItems.reduce((s, i) => s + i.quantity * i.unitPrice * (1 - i.offerPercent / 100), 0) : order.totalAmount)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left px-4 py-2 font-medium text-slate-600">Medicine</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600">Qty</th>
                <th className="text-right px-4 py-2 font-medium text-slate-600 hidden sm:table-cell">Unit Price</th>
                <th className="text-center px-4 py-2 font-medium text-slate-600 hidden sm:table-cell">Offer %</th>
                {editing && <th className="text-right px-4 py-2 font-medium text-slate-600 hidden sm:table-cell">S. Tax</th>}
                <th className="text-right px-4 py-2 font-medium text-slate-600">Total</th>
              </tr>
            </thead>
            <tbody>
              {editing ? editItems.map(item => {
                const lineTotal = item.quantity * item.unitPrice * (1 - item.offerPercent / 100)
                return (
                  <tr key={item.id} className="border-b">
                    <td className="px-4 py-2">
                      <div className="font-medium">{item.medicine.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{item.medicine.code}</div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Input type="number" min="1" className="w-16 h-8 text-xs text-center mx-auto" value={item.quantity}
                        onChange={e => updateEditItem(item.id, { quantity: parseInt(e.target.value) || 1 })} />
                    </td>
                    <td className="px-2 py-2 text-right hidden sm:table-cell">
                      <Input type="number" step="0.01" className="w-24 h-8 text-xs text-right ml-auto" value={item.unitPrice}
                        onChange={e => updateEditItem(item.id, { unitPrice: parseFloat(e.target.value) || 0 })} />
                    </td>
                    <td className="px-2 py-2 text-center hidden sm:table-cell">
                      <Input type="number" min="0" max="100" step="0.5" className="w-16 h-8 text-xs text-center mx-auto" value={item.offerPercent}
                        onChange={e => updateEditItem(item.id, { offerPercent: parseFloat(e.target.value) || 0 })} />
                    </td>
                    <td className="px-2 py-2 text-right hidden sm:table-cell">
                      {item.medicine.salesTaxApplicable ? (
                        <Input type="number" min="0" step="0.01" className="w-20 h-8 text-xs text-right ml-auto" value={item.salesTax}
                          onChange={e => updateEditItem(item.id, { salesTax: parseFloat(e.target.value) || 0 })} />
                      ) : <span className="text-slate-300 text-xs">N/A</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{formatPKR(lineTotal)}</td>
                  </tr>
                )
              }) : order.items.map(item => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-2">
                    <div className="font-medium">{item.medicine.name}</div>
                    <div className="text-xs text-slate-400 font-mono">{item.medicine.code}</div>
                  </td>
                  <td className="px-4 py-2 text-center">{item.quantity}</td>
                  <td className="px-4 py-2 text-right hidden sm:table-cell">{formatPKR(item.unitPrice)}</td>
                  <td className="px-4 py-2 text-center hidden sm:table-cell">
                    {Number(item.offerPercent) > 0 ? `${item.offerPercent}%` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{formatPKR(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {order.notes && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-slate-600"><span className="font-medium">Notes:</span> {order.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
