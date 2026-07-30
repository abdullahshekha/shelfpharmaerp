'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatPKR } from '@/lib/utils/format'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

interface SheetItem {
  id: string
  medicine: { id: string; code: string; name: string; manufacturer: { name: string } }
  quantity: number
  offerPercent: number
  bonusQty: number
  specialPrice: number | null
}

interface Sheet {
  id: string
  retailer: { id: string; name: string; phone: string | null }
  offerList: { id: string; name: string | null; listNumber: string }
  items: SheetItem[]
}

export default function OfferListCustomerSheetPage() {
  const { id, customerId } = useParams<{ id: string; customerId: string }>()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchSheet = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/offer-list/${id}/customers/${customerId}`)
    const json = await res.json()
    setSheet(json.data ?? null)
    setQuantities(new Map((json.data?.items ?? []).map((i: SheetItem) => [i.medicine.id, i.quantity])))
    setLoading(false)
  }, [id, customerId])

  useEffect(() => { fetchSheet() }, [fetchSheet])

  const updateQty = (medicineId: string, qty: number) => {
    setQuantities(prev => new Map(prev).set(medicineId, qty))
  }

  const save = async () => {
    setSaving(true)
    const res = await fetch(`/api/offer-list/${id}/customers/${customerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: Array.from(quantities.entries()).map(([medicineId, quantity]) => ({ medicineId, quantity })),
      }),
    })
    if (res.ok) toast.success('Quantities saved')
    else toast.error('Failed to save')
    setSaving(false)
  }

  if (loading || !sheet) {
    return <div className="p-6 text-slate-400 text-sm animate-pulse">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/offer-list/${id}`}><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">{sheet.retailer.name}</h1>
            <p className="text-slate-500 text-sm">
              #{sheet.offerList.listNumber}{sheet.offerList.name && ` — ${sheet.offerList.name}`}
              {sheet.retailer.phone && ` · ${sheet.retailer.phone}`}
            </p>
          </div>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Quantities'}</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Order Quantities ({sheet.items.length} medicines)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Code</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Medicine</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Manufacturer</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Offer %</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Bonus</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">T.P</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600 w-24">Qty</th>
                </tr>
              </thead>
              <tbody>
                {sheet.items.map(item => (
                  <tr key={item.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.medicine.code}</td>
                    <td className="px-4 py-3 font-medium">{item.medicine.name}</td>
                    <td className="px-4 py-3 text-slate-500">{item.medicine.manufacturer.name}</td>
                    <td className="px-4 py-3 text-right">{Number(item.offerPercent) > 0 ? `${Number(item.offerPercent).toFixed(2)}%` : '—'}</td>
                    <td className="px-4 py-3 text-right">{item.bonusQty > 0 ? item.bonusQty : '—'}</td>
                    <td className="px-4 py-3 text-right font-medium">{item.specialPrice != null ? formatPKR(item.specialPrice) : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <Input
                        type="number"
                        min="0"
                        className="w-20 h-8 text-xs text-center mx-auto"
                        value={quantities.get(item.medicine.id) ?? 0}
                        onChange={e => updateQty(item.medicine.id, parseInt(e.target.value) || 0)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
