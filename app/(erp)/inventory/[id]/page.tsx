'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ArrowLeft, Package, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

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
  manufacturer: { name: string }
  batches: Batch[]
}

export default function MedicineDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [medicine, setMedicine] = useState<Medicine | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchMedicine = () => {
    fetch(`/api/inventory/${id}`)
      .then(r => r.json())
      .then(j => setMedicine(j.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchMedicine() }, [id])

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
