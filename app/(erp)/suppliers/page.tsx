'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Building2, Plus, Search, X, Phone } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface Supplier {
  id: string
  name: string
  type: string
  contactPerson: string | null
  phone: string | null
  address: string | null
  _count: { purchaseInvoices: number }
}

const TYPE_COLORS: Record<string, string> = {
  OPEN_MARKET: 'bg-orange-100 text-orange-700',
  OFFICIAL_DISTRIBUTOR: 'bg-blue-100 text-blue-700',
}

const TYPE_LABELS: Record<string, string> = {
  OPEN_MARKET: 'Open Market',
  OFFICIAL_DISTRIBUTOR: 'Official Distributor',
}

const emptyForm = { name: '', type: 'OFFICIAL_DISTRIBUTOR', contactPerson: '', phone: '', address: '', notes: '' }

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const fetchSuppliers = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (typeFilter) params.set('type', typeFilter)
    const res = await fetch(`/api/suppliers?${params}`)
    const j = await res.json()
    setSuppliers(j.data ?? [])
    setLoading(false)
  }, [search, typeFilter])

  useEffect(() => {
    const t = setTimeout(fetchSuppliers, 300)
    return () => clearTimeout(t)
  }, [fetchSuppliers])

  const createSupplier = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    const res = await fetch('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      toast.success('Supplier added')
      setShowForm(false)
      setForm(emptyForm)
      fetchSuppliers()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to add supplier')
    }
    setSaving(false)
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 size={22} className="text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold">Suppliers</h1>
            <p className="text-slate-500 text-sm">Medicine procurement sources</p>
          </div>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus size={16} /> Add Supplier
        </Button>
      </div>

      {/* Add Supplier Form */}
      {showForm && (
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              New Supplier
              <button onClick={() => setShowForm(false)}><X size={16} className="text-slate-400" /></button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createSupplier} className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Supplier Name *</Label>
                <Input placeholder="Adamjee Drug House" value={form.name} onChange={set('name')} />
              </div>
              <div className="space-y-1.5">
                <Label>Type *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v ?? 'OFFICIAL_DISTRIBUTOR' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OFFICIAL_DISTRIBUTOR">Official Distributor</SelectItem>
                    <SelectItem value="OPEN_MARKET">Open Market</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Contact Person</Label>
                <Input placeholder="Muhammad Usman" value={form.contactPerson} onChange={set('contactPerson')} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="0300-1234567" value={form.phone} onChange={set('phone')} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Address</Label>
                <Input placeholder="Company address" value={form.address} onChange={set('address')} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Notes</Label>
                <Input placeholder="Payment terms, special conditions..." value={form.notes} onChange={set('notes')} />
              </div>
              <div className="col-span-2 flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Supplier'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search suppliers..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={typeFilter || 'all'} onValueChange={v => setTypeFilter(v === 'all' ? '' : (v ?? ''))}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="OFFICIAL_DISTRIBUTOR">Official Distributor</SelectItem>
            <SelectItem value="OPEN_MARKET">Open Market</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Supplier cards */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-slate-100 rounded-lg animate-pulse" />)}
        </div>
      ) : suppliers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-400">
            <Building2 size={32} className="mx-auto mb-3 text-slate-300" />
            No suppliers found. Add your first supplier.
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {suppliers.map(s => (
            <Link key={s.id} href={`/suppliers/${s.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <p className="font-semibold text-slate-900 leading-tight">{s.name}</p>
                    <Badge className={`text-xs flex-shrink-0 ml-2 ${TYPE_COLORS[s.type] ?? ''}`}>
                      {TYPE_LABELS[s.type] ?? s.type}
                    </Badge>
                  </div>
                  {s.contactPerson && <p className="text-sm text-slate-600">{s.contactPerson}</p>}
                  {s.phone && (
                    <p className="text-sm text-slate-500 flex items-center gap-1">
                      <Phone size={12} /> {s.phone}
                    </p>
                  )}
                  <p className="text-xs text-slate-400">{s._count.purchaseInvoices} purchase invoice{s._count.purchaseInvoices !== 1 ? 's' : ''}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
