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

const CATEGORIES = ['Tablet', 'Capsule', 'Syrup', 'Drops/Spray', 'Topical', 'Injection', 'Sachet/Powder', 'Personal Care', 'Other']

export default function AddMedicinePage() {
  const router = useRouter()
  const [manufacturers, setManufacturers] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    code: '',
    name: '',
    genericName: '',
    manufacturerId: '',
    category: '',
    packSize: '',
    tradePrice: '',
    mrp: '',
    minStockLevel: '10',
  })

  useEffect(() => {
    fetch('/api/manufacturers').then(r => r.json()).then(j => setManufacturers(j.data ?? []))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code || !form.name || !form.manufacturerId || !form.tradePrice) {
      toast.error('Code, name, manufacturer, and trade price are required')
      return
    }
    setSaving(true)
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        tradePrice: parseFloat(form.tradePrice),
        mrp: form.mrp ? parseFloat(form.mrp) : null,
        minStockLevel: parseInt(form.minStockLevel),
      }),
    })
    if (res.ok) {
      toast.success('Medicine added')
      router.push('/inventory')
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to add medicine')
    }
    setSaving(false)
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/inventory">
          <Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Add Medicine</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle className="text-base">Medicine Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="code">Code *</Label>
                <Input id="code" placeholder="028146" value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" placeholder="ABOCAL TAB" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value.toUpperCase() }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="genericName">Generic Name</Label>
              <Input id="genericName" placeholder="Calcium Carbonate" value={form.genericName}
                onChange={e => setForm(f => ({ ...f, genericName: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Manufacturer *</Label>
                <Select value={form.manufacturerId || undefined} onValueChange={v => setForm(f => ({ ...f, manufacturerId: v ?? '' }))}>
                  <SelectTrigger><SelectValue placeholder="Select manufacturer" /></SelectTrigger>
                  <SelectContent>
                    {manufacturers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category || undefined} onValueChange={v => setForm(f => ({ ...f, category: v ?? '' }))}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tradePrice">Trade Price (PKR) *</Label>
                <Input id="tradePrice" type="number" step="0.01" placeholder="298.35" value={form.tradePrice}
                  onChange={e => setForm(f => ({ ...f, tradePrice: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mrp">MRP (PKR)</Label>
                <Input id="mrp" type="number" step="0.01" placeholder="350.00" value={form.mrp}
                  onChange={e => setForm(f => ({ ...f, mrp: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minStockLevel">Min Stock Alert</Label>
                <Input id="minStockLevel" type="number" value={form.minStockLevel}
                  onChange={e => setForm(f => ({ ...f, minStockLevel: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="packSize">Pack Size</Label>
              <Input id="packSize" placeholder="10x10 or 120ml" value={form.packSize}
                onChange={e => setForm(f => ({ ...f, packSize: e.target.value }))} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link href="/inventory"><Button type="button" variant="outline">Cancel</Button></Link>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Medicine'}</Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
