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
import { ArrowLeft, Package, Trash2, Pencil, X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

interface Batch {
  id: string
  batchNumber: string
  expiryDate: string
  quantityIn: number
  currentQty: number
  purchasePrice: number
  tradePrice: number
  mrp: number | null
}

interface Medicine {
  id: string
  code: string
  name: string
  genericName: string | null
  category: string | null
  packSize: string | null
  tradePrice: number | null
  mrp: number | null
  bonusQty: string | null
  bonusNote: string | null
  salesTaxApplicable: boolean
  minStockLevel: number
  manufacturerId: string
  manufacturer: { id: string; name: string }
  batches: Batch[]
}

export default function MedicineDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useCurrentUser()
  const isAdmin = user?.role === 'ADMIN'
  const [medicine, setMedicine] = useState<Medicine | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [manufacturers, setManufacturers] = useState<{ id: string; name: string }[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [editForm, setEditForm] = useState({
    name: '', genericName: '', manufacturerId: '', category: '', packSize: '',
    salesTaxApplicable: 'false', minStockLevel: '10',
  })

  const fetchMedicine = () => {
    fetch(`/api/inventory/${id}`)
      .then(r => r.json())
      .then(j => {
        const m: Medicine = j.data
        setMedicine(m)
        setEditForm({
          name: m.name ?? '',
          genericName: m.genericName ?? '',
          manufacturerId: m.manufacturerId ?? '',
          category: m.category ?? '',
          packSize: m.packSize ?? '',
          salesTaxApplicable: m.salesTaxApplicable ? 'true' : 'false',
          minStockLevel: String(m.minStockLevel ?? 10),
        })
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchMedicine() }, [id])

  useEffect(() => {
    fetch('/api/manufacturers').then(r => r.json()).then(j => setManufacturers(j.data ?? []))
    fetch('/api/categories').then(r => r.json()).then(j => setCategories(j.data ?? []))
  }, [])

  const saveEdit = async () => {
    if (!editForm.name.trim() || !editForm.manufacturerId) {
      toast.error('Name and manufacturer are required')
      return
    }
    setSaving(true)
    const res = await fetch(`/api/inventory/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...editForm,
        salesTaxApplicable: editForm.salesTaxApplicable === 'true',
        minStockLevel: parseInt(editForm.minStockLevel) || 10,
      }),
    })
    if (res.ok) {
      toast.success('Item updated')
      setEditing(false)
      fetchMedicine()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to save changes')
    }
    setSaving(false)
  }

  const set = (field: keyof typeof editForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditForm(f => ({ ...f, [field]: e.target.value }))

  const router = useRouter()
  const [blockers, setBlockers] = useState<string[] | null>(null)

  const deleteItem = async () => {
    if (!confirm(`Permanently delete ${medicine?.name}? This cannot be undone.`)) return
    const res = await fetch(`/api/inventory/${id}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { toast.success('Item deleted'); router.push('/inventory'); return }
    if (res.status === 409 && j.blockers) { setBlockers(j.blockers); return }
    toast.error(j.error ?? 'Failed to delete item')
  }

  const deactivateItem = async () => {
    if (!medicine) return
    const res = await fetch(`/api/inventory/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: medicine.name, genericName: medicine.genericName, manufacturerId: medicine.manufacturerId,
        category: medicine.category, packSize: medicine.packSize, salesTaxApplicable: medicine.salesTaxApplicable,
        minStockLevel: medicine.minStockLevel, isActive: false,
      }),
    })
    if (res.ok) { toast.success('Item deactivated'); setBlockers(null); fetchMedicine() }
    else toast.error('Failed to deactivate')
  }

  const deleteBatch = async (batchId: string) => {
    if (!confirm('Delete this batch? Any remaining stock in it is written off (Accounts: Other Expenses).')) return
    const res = await fetch(`/api/inventory/${id}/batches?batchId=${batchId}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      if (j.pending) toast.info(j.message)
      else toast.success(j.writtenOff > 0 ? `Batch deleted — Rs. ${Number(j.writtenOff).toLocaleString('en-PK', { minimumFractionDigits: 2 })} written off to Other Expenses` : 'Batch deleted')
      fetchMedicine()
    } else {
      toast.error(j.error ?? 'Failed to delete batch')
    }
  }

  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading...</div>
  if (!medicine) return <div className="p-8 text-slate-400">Medicine not found.</div>

  const totalStock = medicine.batches.reduce((s, b) => s + b.currentQty, 0)
  const now = new Date()
  const ninetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/inventory">
          <Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{medicine.name}</h1>
          <p className="text-slate-500 text-sm font-mono">{medicine.code}</p>
        </div>
        <Button size="sm" variant="outline" className="ml-auto gap-1" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Edit
        </Button>
        {isAdmin && (
          <Button size="sm" variant="outline" className="gap-1 text-red-600 border-red-200 hover:bg-red-50" onClick={deleteItem}>
            <Trash2 size={14} /> Delete item
          </Button>
        )}
      </div>
      {blockers && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm space-y-2">
          <p className="font-medium text-orange-800">This item cannot be deleted because it has:</p>
          <ul className="list-disc pl-5 text-orange-700">{blockers.map(b => <li key={b}>{b}</li>)}</ul>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={deactivateItem}>Deactivate instead</Button>
            <Button size="sm" variant="ghost" onClick={() => setBlockers(null)}>Dismiss</Button>
          </div>
        </div>
      )}

      {/* Inline Edit Form */}
      {editing && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-blue-900">Edit Item Details</p>
              <button onClick={() => setEditing(false)}><X size={16} className="text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Name *</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Generic Name</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.genericName} onChange={set('genericName')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Manufacturer *</Label>
                <Select
                  items={manufacturers.map(m => ({ value: m.id, label: m.name }))}
                  value={editForm.manufacturerId || undefined}
                  onValueChange={v => setEditForm(f => ({ ...f, manufacturerId: v ?? '' }))}
                >
                  <SelectTrigger className="h-8 text-sm bg-white w-full"><SelectValue placeholder="Select manufacturer" /></SelectTrigger>
                  <SelectContent>
                    {manufacturers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select
                  items={categories.map(c => ({ value: c.name, label: c.name }))}
                  value={editForm.category || undefined}
                  onValueChange={v => setEditForm(f => ({ ...f, category: v ?? '' }))}
                >
                  <SelectTrigger className="h-8 text-sm bg-white w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pack Size</Label>
                <Input className="h-8 text-sm bg-white" value={editForm.packSize} onChange={set('packSize')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Min Stock Alert</Label>
                <Input className="h-8 text-sm bg-white" type="number" value={editForm.minStockLevel} onChange={set('minStockLevel')} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Sales Tax Applicable *</Label>
                <Select
                  items={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
                  value={editForm.salesTaxApplicable}
                  onValueChange={v => setEditForm(f => ({ ...f, salesTaxApplicable: v ?? 'false' }))}
                >
                  <SelectTrigger className="h-8 text-sm bg-white w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={saveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Medicine Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Manufacturer" value={medicine.manufacturer.name} />
            <Row label="Generic Name" value={medicine.genericName ?? '—'} />
            <Row label="Category" value={medicine.category ?? '—'} />
            <Row label="Pack Size" value={medicine.packSize ?? '—'} />
            <Row label="Trade Price" value={medicine.tradePrice != null ? formatPKR(medicine.tradePrice) : 'No priced batch yet'} />
            <Row label="MRP" value={medicine.mrp ? formatPKR(medicine.mrp) : '—'} />
            <Row label="Sales Tax Applicable" value={medicine.salesTaxApplicable ? 'Yes' : 'No'} />
            <Row label="Bonus Qty" value={medicine.bonusQty ?? '—'} />
            <Row label="Bonus Note" value={medicine.bonusNote ?? '—'} />
            <Row label="Min Stock Level" value={String(medicine.minStockLevel)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Package size={16} /> Stock Summary
            </CardTitle>
            <Badge className={
              totalStock === 0 ? 'bg-red-100 text-red-800'
              : totalStock <= medicine.minStockLevel ? 'bg-yellow-100 text-yellow-800'
              : 'bg-green-100 text-green-800'
            }>
              {totalStock === 0 ? 'Out of Stock' : `${totalStock} units`}
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500">
              {medicine.batches.length} batch{medicine.batches.length !== 1 ? 'es' : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Batch History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Batch History (FEFO)</CardTitle>
          <p className="text-xs text-slate-500 font-normal mt-1">
            New batches are added by creating a{' '}
            <Link href="/suppliers" className="text-blue-500 hover:underline">Purchase Invoice</Link>.
          </p>
        </CardHeader>

        <CardContent className="p-0">
          {medicine.batches.length === 0 ? (
            <p className="text-sm text-slate-400 p-6">No batches recorded yet. Record a purchase invoice to add stock.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Batch #</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Expiry</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">In</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Remaining</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Purchase Price</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Trade Price</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">MRP</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {medicine.batches.map(b => {
                    const expDate = new Date(b.expiryDate)
                    const isNearExpiry = expDate <= ninetyDays
                    const isExpired = expDate < now
                    return (
                      <tr key={b.id} className="border-b hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs">{b.batchNumber}</td>
                        <td className="px-4 py-3">
                          <span className={isExpired ? 'text-red-600 font-medium' : isNearExpiry ? 'text-orange-600' : ''}>
                            {formatDate(b.expiryDate)}
                            {isExpired && ' (EXPIRED)'}
                            {!isExpired && isNearExpiry && ' ⚠'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">{b.quantityIn}</td>
                        <td className="px-4 py-3 text-right font-medium">
                          {b.currentQty === 0 ? <span className="text-slate-400">0</span> : b.currentQty}
                        </td>
                        <td className="px-4 py-3 text-right">{formatPKR(b.purchasePrice)}</td>
                        <td className="px-4 py-3 text-right">{formatPKR(b.tradePrice)}</td>
                        <td className="px-4 py-3 text-right">{b.mrp ? formatPKR(b.mrp) : '—'}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => deleteBatch(b.id)} className="text-red-400 hover:text-red-600">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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
      <span className="font-medium text-right">{value}</span>
    </div>
  )
}
