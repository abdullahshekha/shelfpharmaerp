'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface SalesRep { id: string; name: string }
interface Area { id: string; name: string }

export default function AddRetailerPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [salesReps, setSalesReps] = useState<SalesRep[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [form, setForm] = useState({
    name: '', ownerName: '', phone: '', whatsappNumber: '',
    areaId: '', address: '', drugLicenseNumber: '',
    drugLicenseExpiry: '', creditLimit: '0', creditDays: '0',
    paymentMode: 'CASH', salesRepId: '', notes: '',
  })

  useEffect(() => {
    fetch('/api/employees?role=SALES_REP').then(r => r.json()).then(j => setSalesReps(j.data ?? []))
    fetch('/api/areas').then(r => r.json()).then(j => setAreas(j.data ?? []))
  }, [])

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const isCheque = form.paymentMode === 'CHEQUE'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) { toast.error('Name is required'); return }
    setSaving(true)
    const res = await fetch('/api/retailers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        areaId: form.areaId || null,
        creditLimit: isCheque ? (parseFloat(form.creditLimit) || 0) : 0,
        creditDays: isCheque ? (parseInt(form.creditDays) || 0) : 0,
        drugLicenseExpiry: form.drugLicenseExpiry || null,
        salesRepId: form.salesRepId || null,
      }),
    })
    if (res.ok) {
      toast.success('Retailer added')
      router.push('/retailers')
    } else {
      toast.error('Failed to add retailer')
    }
    setSaving(false)
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/retailers"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <h1 className="text-2xl font-bold">Add Retailer</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle className="text-base">Retailer Information</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label>Shop Name *</Label>
                <Input placeholder="ABC Pharmacy" value={form.name} onChange={set('name')} />
              </div>
              <div className="space-y-1.5">
                <Label>Owner Name</Label>
                <Input placeholder="Muhammad Ali" value={form.ownerName} onChange={set('ownerName')} />
              </div>

              {/* Payment Mode */}
              <div className="space-y-1.5">
                <Label>Payment Mode *</Label>
                <Select value={form.paymentMode} onValueChange={v => setForm(f => ({ ...f, paymentMode: v ?? 'CASH' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="CHEQUE">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Area dropdown */}
              <div className="space-y-1.5">
                <Label>Area</Label>
                <Select value={form.areaId || 'none'} onValueChange={v => setForm(f => ({ ...f, areaId: v === 'none' ? '' : (v ?? '') }))}>
                  <SelectTrigger><SelectValue placeholder="Select area" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No area</SelectItem>
                    {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {areas.length === 0 && (
                  <p className="text-xs text-slate-400">
                    No areas yet. <Link href="/settings" className="text-blue-500 hover:underline">Add areas in Settings.</Link>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="0300-1234567" value={form.phone} onChange={set('phone')} />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp Number</Label>
                <Input placeholder="923001234567" value={form.whatsappNumber} onChange={set('whatsappNumber')} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Address</Label>
                <Input placeholder="Shop #12, Main Bahadurabad Road" value={form.address} onChange={set('address')} />
              </div>

              <div className="space-y-1.5 col-span-2">
                <Label>Assigned Sales Rep</Label>
                <Select value={form.salesRepId || 'none'} onValueChange={v => setForm(f => ({ ...f, salesRepId: v === 'none' ? '' : (v ?? '') }))}>
                  <SelectTrigger><SelectValue placeholder="Select sales rep (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No sales rep</SelectItem>
                    {salesReps.map(rep => <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Drug License #</Label>
                <Input value={form.drugLicenseNumber} onChange={set('drugLicenseNumber')} />
              </div>
              <div className="space-y-1.5">
                <Label>License Expiry</Label>
                <Input type="date" value={form.drugLicenseExpiry} onChange={set('drugLicenseExpiry')} />
              </div>

              {/* Credit fields — only visible for Cheque */}
              {isCheque && (
                <>
                  <div className="space-y-1.5">
                    <Label>Credit Limit (PKR)</Label>
                    <Input type="number" value={form.creditLimit} onChange={set('creditLimit')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Credit Days</Label>
                    <Input type="number" value={form.creditDays} onChange={set('creditDays')} />
                  </div>
                </>
              )}
              {!isCheque && (
                <div className="col-span-2 p-2 bg-slate-50 rounded text-xs text-slate-500">
                  Credit limit is only applicable for Cheque payment mode.
                </div>
              )}

              <div className="space-y-1.5 col-span-2">
                <Label>Notes</Label>
                <Input placeholder="Any special notes..." value={form.notes} onChange={set('notes')} />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link href="/retailers"><Button type="button" variant="outline">Cancel</Button></Link>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Retailer'}</Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
