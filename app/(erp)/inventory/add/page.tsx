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

export default function ItemCreationPage() {
  const router = useRouter()
  const [manufacturers, setManufacturers] = useState<{ id: string; name: string }[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    genericName: '',
    manufacturerId: '',
    category: '',
    packSize: '',
    salesTaxApplicable: 'false',
    minStockLevel: '10',
  })

  useEffect(() => {
    fetch('/api/manufacturers').then(r => r.json()).then(j => setManufacturers(j.data ?? []))
    fetch('/api/categories').then(r => r.json()).then(j => setCategories(j.data ?? []))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.manufacturerId) {
      toast.error('Name and manufacturer are required')
      return
    }
    setSaving(true)
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        salesTaxApplicable: form.salesTaxApplicable === 'true',
        minStockLevel: parseInt(form.minStockLevel),
      }),
    })
    if (res.ok) {
      const j = await res.json()
      toast.success(`Item created — code ${j.data.code}`)
      router.push(`/inventory/${j.data.id}`)
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to create item')
    }
    setSaving(false)
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/inventory">
          <Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Item Creation</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle className="text-base">Medicine Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-500 -mt-1">
              A unique item code is generated automatically. Trade Price and MRP are set when you add the first stock batch.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" placeholder="ABOCAL TAB" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value.toUpperCase() }))} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="genericName">Generic Name</Label>
              <Input id="genericName" placeholder="Calcium Carbonate" value={form.genericName}
                onChange={e => setForm(f => ({ ...f, genericName: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Manufacturer *</Label>
                <Select
                  items={manufacturers.map(m => ({ value: m.id, label: m.name }))}
                  value={form.manufacturerId || undefined}
                  onValueChange={v => setForm(f => ({ ...f, manufacturerId: v ?? '' }))}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select manufacturer" /></SelectTrigger>
                  <SelectContent>
                    {manufacturers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  items={categories.map(c => ({ value: c.name, label: c.name }))}
                  value={form.category || undefined}
                  onValueChange={v => setForm(f => ({ ...f, category: v ?? '' }))}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="packSize">Pack Size</Label>
                <Input id="packSize" placeholder="10x10 or 120ml" value={form.packSize}
                  onChange={e => setForm(f => ({ ...f, packSize: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minStockLevel">Min Stock Alert</Label>
                <Input id="minStockLevel" type="number" value={form.minStockLevel}
                  onChange={e => setForm(f => ({ ...f, minStockLevel: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Sales Tax Applicable *</Label>
              <Select
                items={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
                value={form.salesTaxApplicable}
                onValueChange={v => setForm(f => ({ ...f, salesTaxApplicable: v ?? 'false' }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Yes</SelectItem>
                  <SelectItem value="false">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link href="/inventory"><Button type="button" variant="outline">Cancel</Button></Link>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Item'}</Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
