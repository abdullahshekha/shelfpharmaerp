'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ArrowLeft, Package, Plus, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface Batch {
  id: string
  batchNumber: string
  expiryDate: string
  quantityIn: number
  currentQty: number
  purchasePrice: number
}

interface Medicine {
  id: string
  code: string
  name: string
  genericName: string | null
  category: string | null
  packSize: string | null
  tradePrice: number
  mrp: number | null
  bonusQty: string | null
  bonusNote: string | null
  minStockLevel: number
  manufacturer: { name: string }
  batches: Batch[]
}

const emptyBatch = { batchNumber: '', expiryDate: '', quantityIn: '', purchasePrice: '' }

export default function MedicineDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [medicine, setMedicine] = useState<Medicine | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBatchForm, setShowBatchForm] = useState(false)
  const [batchForm, setBatchForm] = useState(emptyBatch)
  const [savingBatch, setSavingBatch] = useState(false)

  const fetchMedicine = () => {
    fetch(`/api/inventory/${id}`)
      .then(r => r.json())
      .then(j => setMedicine(j.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchMedicine() }, [id])

  const addBatch = async () => {
    if (!batchForm.batchNumber || !batchForm.expiryDate || !batchForm.quantityIn || !batchForm.purchasePrice) {
      toast.error('All batch fields are required')
      return
    }
    setSavingBatch(true)
    const res = await fetch(`/api/inventory/${id}/batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchForm),
    })
    if (res.ok) {
      toast.success('Batch added')
      setShowBatchForm(false)
      setBatchForm(emptyBatch)
      fetchMedicine()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to add batch')
    }
    setSavingBatch(false)
  }

  const deleteBatch = async (batchId: string) => {
    if (!confirm('Delete this batch?')) return
    const res = await fetch(`/api/inventory/${id}/batches?batchId=${batchId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Batch deleted')
      fetchMedicine()
    } else {
      toast.error('Failed to delete batch')
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
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Medicine Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Manufacturer" value={medicine.manufacturer.name} />
            <Row label="Generic Name" value={medicine.genericName ?? '—'} />
            <Row label="Category" value={medicine.category ?? '—'} />
            <Row label="Pack Size" value={medicine.packSize ?? '—'} />
            <Row label="Trade Price" value={formatPKR(medicine.tradePrice)} />
            <Row label="MRP" value={medicine.mrp ? formatPKR(medicine.mrp) : '—'} />
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Batch History (FEFO)</CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowBatchForm(true)}>
            <Plus size={14} /> Add Batch
          </Button>
        </CardHeader>

        {/* Add Batch Form */}
        {showBatchForm && (
          <div className="mx-4 mb-4 border rounded-lg p-4 bg-blue-50 border-blue-200 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium text-blue-900 text-sm">New Batch</p>
              <button onClick={() => { setShowBatchForm(false); setBatchForm(emptyBatch) }}>
                <X size={16} className="text-slate-400 hover:text-slate-600" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Batch Number *</Label>
                <Input
                  placeholder="e.g. BTN-2025-001"
                  className="h-8 text-sm"
                  value={batchForm.batchNumber}
                  onChange={e => setBatchForm(f => ({ ...f, batchNumber: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Expiry Date *</Label>
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={batchForm.expiryDate}
                  onChange={e => setBatchForm(f => ({ ...f, expiryDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Quantity *</Label>
                <Input
                  type="number" min="1" placeholder="100"
                  className="h-8 text-sm"
                  value={batchForm.quantityIn}
                  onChange={e => setBatchForm(f => ({ ...f, quantityIn: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Purchase Price (PKR) *</Label>
                <Input
                  type="number" step="0.01" placeholder="250.00"
                  className="h-8 text-sm"
                  value={batchForm.purchasePrice}
                  onChange={e => setBatchForm(f => ({ ...f, purchasePrice: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => { setShowBatchForm(false); setBatchForm(emptyBatch) }}>
                Cancel
              </Button>
              <Button size="sm" onClick={addBatch} disabled={savingBatch}>
                {savingBatch ? 'Saving...' : 'Add Batch'}
              </Button>
            </div>
          </div>
        )}

        <CardContent className="p-0">
          {medicine.batches.length === 0 ? (
            <p className="text-sm text-slate-400 p-6">No batches recorded yet. Add a batch to track stock.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Batch #</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Expiry</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">In</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Remaining</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Purchase Price</th>
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
