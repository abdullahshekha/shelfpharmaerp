'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ArrowLeft, Phone, MapPin, Trash2, UserCheck, Pencil, X, Check } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface Order { id: string; orderNumber: string; orderDate: string; status: string; totalAmount: number }
interface Invoice { id: string; invoiceNumber: string; invoiceDate: string; totalAmount: number; status: string }
interface SalesRep { id: string; name: string }
interface Area { id: string; name: string }

interface Retailer {
  id: string; name: string; ownerName: string | null; phone: string | null
  whatsappNumber: string | null; area: Area | null; areaId: string | null
  address: string | null; drugLicenseNumber: string | null; drugLicenseExpiry: string | null
  creditLimit: number; creditDays: number; paymentMode: string; notes: string | null
  salesRepId: string | null; salesRep: { id: string; name: string } | null
  orders: Order[]; invoices: Invoice[]; outstandingBalance: number
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700', CONFIRMED: 'bg-blue-100 text-blue-700',
  PICKING: 'bg-yellow-100 text-yellow-700', DISPATCHED: 'bg-orange-100 text-orange-700',
  DELIVERED: 'bg-green-100 text-green-700', CANCELLED: 'bg-red-100 text-red-700',
}

export default function RetailerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [retailer, setRetailer] = useState<Retailer | null>(null)
  const [salesReps, setSalesReps] = useState<SalesRep[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '', ownerName: '', phone: '', whatsappNumber: '',
    areaId: '', address: '', drugLicenseNumber: '', drugLicenseExpiry: '',
    creditLimit: '', creditDays: '', paymentMode: 'CASH', notes: '',
  })

  const fetchRetailer = () =>
    fetch(`/api/retailers/${id}`)
      .then(r => r.json())
      .then(j => {
        const r = j.data
        setRetailer(r)
        if (r.salesRep) {
          setSalesReps(prev =>
            prev.some(s => s.id === r.salesRep.id) ? prev : [r.salesRep, ...prev]
          )
        }
        setEditForm({
          name: r.name ?? '',
          ownerName: r.ownerName ?? '',
          phone: r.phone ?? '',
          whatsappNumber: r.whatsappNumber ?? '',
          areaId: r.areaId ?? '',
          address: r.address ?? '',
          drugLicenseNumber: r.drugLicenseNumber ?? '',
          drugLicenseExpiry: r.drugLicenseExpiry ? r.drugLicenseExpiry.slice(0, 10) : '',
          creditLimit: String(r.creditLimit ?? 0),
          creditDays: String(r.creditDays ?? 0),
          paymentMode: r.paymentMode ?? 'CASH',
          notes: r.notes ?? '',
        })
      })
      .finally(() => setLoading(false))

  useEffect(() => { fetchRetailer() }, [id])

  useEffect(() => {
    fetch('/api/employees?role=SALES_REP')
      .then(r => r.json())
      .then(j => {
        const list: SalesRep[] = j.data ?? []
        setSalesReps(prev => {
          const ids = new Set(list.map((r: SalesRep) => r.id))
          const extra = prev.filter(r => !ids.has(r.id))
          return [...extra, ...list]
        })
      })
    fetch('/api/areas').then(r => r.json()).then(j => setAreas(j.data ?? []))
  }, [])

  const isCheque = editForm.paymentMode === 'CHEQUE'

  const saveEdit = async () => {
    if (!editForm.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    const res = await fetch(`/api/retailers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...editForm,
        areaId: editForm.areaId || null,
        creditLimit: isCheque ? (parseFloat(editForm.creditLimit) || 0) : 0,
        creditDays: isCheque ? (parseInt(editForm.creditDays) || 0) : 0,
        drugLicenseExpiry: editForm.drugLicenseExpiry || null,
        salesRepId: retailer?.salesRepId ?? null,
      }),
    })
    if (res.ok) {
      toast.success('Retailer updated')
      setEditing(false)
      fetchRetailer()
    } else {
      toast.error('Failed to save changes')
    }
    setSaving(false)
  }

  const assignSalesRep = async (salesRepId: string | null) => {
    const current = retailer
    if (!current) return
    const res = await fetch(`/api/retailers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, areaId: current.areaId, salesRepId }),
    })
    if (res.ok) { toast.success(salesRepId ? 'Sales rep assigned' : 'Sales rep removed'); fetchRetailer() }
    else toast.error('Failed to update')
  }

  const deleteRetailer = async () => {
    if (!confirm('Delete this retailer?')) return
    const res = await fetch(`/api/retailers/${id}`, { method: 'DELETE' })
    if (res.ok) {
      const j = await res.json()
      if (j.pending) { toast.info(j.message); return }
      toast.success('Retailer deleted')
      router.push('/retailers')
    } else {
      toast.error('Failed to delete retailer')
    }
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditForm(f => ({ ...f, [field]: e.target.value }))

  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading...</div>
  if (!retailer) return <div className="p-8 text-slate-400">Retailer not found.</div>

  const creditPct = retailer.creditLimit > 0 ? Math.min((retailer.outstandingBalance / retailer.creditLimit) * 100, 100) : 0
  const licenseExpiry = retailer.drugLicenseExpiry ? new Date(retailer.drugLicenseExpiry) : null
  const licenseNearExpiry = licenseExpiry && licenseExpiry < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/retailers"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">{retailer.name}</h1>
          <div className="flex items-center gap-3 mt-0.5">
            {retailer.area && <p className="text-slate-500 text-sm flex items-center gap-1"><MapPin size={12} />{retailer.area.name}</p>}
            <Badge className={retailer.paymentMode === 'CHEQUE' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}>
              {retailer.paymentMode}
            </Badge>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href={`/orders/new?retailerId=${retailer.id}`}><Button size="sm">New Order</Button></Link>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit
          </Button>
          <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 gap-1" onClick={deleteRetailer}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </div>

      {/* Inline Edit Form */}
      {editing && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-blue-900">Edit Retailer Details</p>
              <button onClick={() => setEditing(false)}><X size={16} className="text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Shop Name *</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.name} onChange={set('name')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Owner Name</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.ownerName} onChange={set('ownerName')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Payment Mode</Label>
                <Select value={editForm.paymentMode} onValueChange={v => setEditForm(f => ({ ...f, paymentMode: v ?? 'CASH' }))}>
                  <SelectTrigger className="h-8 text-sm bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="CHEQUE">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Area</Label>
                <Select value={editForm.areaId || 'none'} onValueChange={v => setEditForm(f => ({ ...f, areaId: v === 'none' ? '' : (v ?? '') }))}>
                  <SelectTrigger className="h-8 text-sm bg-white"><SelectValue placeholder="Select area" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No area</SelectItem>
                    {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.phone} onChange={set('phone')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">WhatsApp Number</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.whatsappNumber} onChange={set('whatsappNumber')} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Address</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.address} onChange={set('address')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Drug License #</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.drugLicenseNumber} onChange={set('drugLicenseNumber')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">License Expiry</Label>
                <Input className="h-8 text-sm bg-white" type="date" value={editForm.drugLicenseExpiry} onChange={set('drugLicenseExpiry')} />
              </div>
              {isCheque ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Credit Limit (PKR)</Label>
                    <Input className="h-8 text-sm bg-white" type="number" value={editForm.creditLimit} onChange={set('creditLimit')} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Credit Days</Label>
                    <Input className="h-8 text-sm bg-white" type="number" value={editForm.creditDays} onChange={set('creditDays')} />
                  </div>
                </>
              ) : (
                <div className="col-span-2 p-2 bg-white/60 rounded text-xs text-slate-500">
                  Credit limit is only applicable for Cheque payment mode.
                </div>
              )}
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Notes</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.notes} onChange={set('notes')} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={saveEdit} disabled={saving} className="gap-1">
                <Check size={14} /> {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Contact Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {retailer.ownerName && <Row label="Owner" value={retailer.ownerName} />}
            {retailer.phone && (
              <div className="flex justify-between">
                <span className="text-slate-500">Phone</span>
                <a href={`tel:${retailer.phone}`} className="font-medium flex items-center gap-1 text-blue-600">
                  <Phone size={12} />{retailer.phone}
                </a>
              </div>
            )}
            {retailer.whatsappNumber && <Row label="WhatsApp" value={retailer.whatsappNumber} />}
            {retailer.area && <Row label="Area" value={retailer.area.name} />}
            {retailer.address && <Row label="Address" value={retailer.address} />}
            {retailer.notes && <Row label="Notes" value={retailer.notes} />}
            <div className="flex justify-between items-center pt-1">
              <span className="text-slate-500 flex items-center gap-1"><UserCheck size={13} /> Sales Rep</span>
              <Select value={retailer.salesRepId ?? 'none'} onValueChange={v => assignSalesRep(v === 'none' ? null : (v ?? null))}>
                <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Assign rep" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No sales rep</SelectItem>
                  {salesReps.map(rep => <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Credit & Compliance</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Payment Mode" value={retailer.paymentMode} />
            {retailer.paymentMode === 'CHEQUE' ? (
              <>
                <Row label="Credit Limit" value={formatPKR(retailer.creditLimit)} />
                <Row label="Credit Days" value={`${retailer.creditDays} days`} />
                <Row label="Outstanding" value={formatPKR(retailer.outstandingBalance)} />
                {retailer.creditLimit > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Credit utilization</span>
                      <span>{Math.round(creditPct)}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full">
                      <div className={`h-2 rounded-full ${creditPct >= 100 ? 'bg-red-600' : creditPct > 80 ? 'bg-orange-400' : 'bg-green-500'}`}
                        style={{ width: `${creditPct}%` }} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-slate-400 text-xs">Cash retailer — no credit terms apply.</p>
            )}
            {retailer.drugLicenseNumber && <Row label="Drug License #" value={retailer.drugLicenseNumber} />}
            {licenseExpiry && (
              <div className="flex justify-between">
                <span className="text-slate-500">License Expiry</span>
                <span className={licenseNearExpiry ? 'text-red-600 font-medium' : 'font-medium'}>
                  {formatDate(licenseExpiry)}{licenseNearExpiry && ' ⚠'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            Recent Orders
            <Link href={`/orders?retailerId=${retailer.id}`}>
              <Button variant="ghost" size="sm" className="text-xs">View all</Button>
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {retailer.orders.length === 0 ? (
            <p className="text-sm text-slate-400 p-6">No orders yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Order #</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600">Status</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-600">Total</th>
                </tr>
              </thead>
              <tbody>
                {retailer.orders.map(o => (
                  <tr key={o.id} className="border-b hover:bg-slate-50 cursor-pointer"
                    onClick={() => window.location.href = `/orders/${o.id}`}>
                    <td className="px-4 py-2 font-mono text-xs">{o.orderNumber}</td>
                    <td className="px-4 py-2">{formatDate(o.orderDate)}</td>
                    <td className="px-4 py-2">
                      <Badge className={`text-xs ${STATUS_COLORS[o.status] ?? ''}`}>{o.status}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right">{formatPKR(o.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-right max-w-[60%]">{value}</span>
    </div>
  )
}
