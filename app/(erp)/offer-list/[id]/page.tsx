'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate } from '@/lib/utils/format'
import { ArrowLeft, Eye, Download, FileText, Zap, RefreshCw, Users, Plus, X, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { CUSTOMER_TYPES } from '@/lib/constants'
import { COMMENT_TYPES, formatOfferComment, isOfferAtLoss, type CommentType } from '@/lib/utils/offer-comment'

interface OfferListItem {
  id: string
  medicineId: string
  medicine: { id: string; code: string; name: string; manufacturer: { name: string } }
  purchasePercent: number
  offerPercent: number
  specialPrice: number | null
  salesTax: number
  commentType: CommentType
  commentNetPrice: number | null
  commentMinOrderQty: number | null
  commentQtyFree: number | null
  commentExtraPercent: number | null
  stock: number
  expiryMMYY: string | null
  purchasePrice: number | null
}

interface OfferListDetail {
  id: string
  name: string | null
  listNumber: string
  listDate: string
  isActive: boolean
  items: OfferListItem[]
  assignments: { customerType: string }[]
  _count: { customers: number }
}

interface AssignedCustomer {
  id: string
  retailer: { id: string; name: string; phone: string | null }
  itemCount: number
  filledCount: number
}

export default function OfferListDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [list, setList] = useState<OfferListDetail | null>(null)
  const [items, setItems] = useState<OfferListItem[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<AssignedCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [listRes, customersRes] = await Promise.all([
      fetch(`/api/offer-list/${id}`),
      fetch(`/api/offer-list/${id}/customers`),
    ])
    const listJson = await listRes.json()
    setList(listJson.data ?? null)
    setItems(listJson.data?.items ?? [])
    setDirty(false)
    setCustomers((await customersRes.json()).data ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => { fetchAll() }, [fetchAll])

  const updateItem = (medicineId: string, patch: Partial<OfferListItem>) => {
    setItems(prev => prev.map(it => (it.medicineId === medicineId ? { ...it, ...patch } : it)))
    setDirty(true)
  }

  const saveChanges = async () => {
    setSaving(true)
    const res = await fetch(`/api/offer-list/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map(it => ({
          medicineId: it.medicineId,
          offerPercent: it.offerPercent,
          specialPrice: it.specialPrice,
          salesTax: it.salesTax,
          commentType: it.commentType,
          commentNetPrice: it.commentNetPrice,
          commentMinOrderQty: it.commentMinOrderQty,
          commentQtyFree: it.commentQtyFree,
          commentExtraPercent: it.commentExtraPercent,
        })),
      }),
    })
    if (res.ok) { toast.success('Changes saved'); fetchAll() }
    else toast.error('Failed to save changes')
    setSaving(false)
  }

  const refresh = async () => {
    if (dirty && !confirm('You have unsaved changes that will be discarded. Refresh anyway?')) return
    setRefreshing(true)
    const res = await fetch(`/api/offer-list/${id}/refresh`, { method: 'POST' })
    if (res.ok) {
      const j = await res.json()
      toast.success(`Refreshed — ${j.data.total} in-stock medicines (${j.data.added} added, ${j.data.removed} removed)`)
      fetchAll()
    } else {
      toast.error('Failed to refresh')
    }
    setRefreshing(false)
  }

  const activate = async () => {
    const res = await fetch(`/api/offer-list/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    })
    if (res.ok) { toast.success('Offer list activated'); fetchAll() }
    else toast.error('Failed to activate')
  }

  const toggleType = (type: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const assignTypes = async () => {
    if (selectedTypes.size === 0) { toast.error('Select at least one customer type'); return }
    setAssigning(true)
    const res = await fetch(`/api/offer-list/${id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerTypes: Array.from(selectedTypes) }),
    })
    if (res.ok) {
      toast.success('Customer types assigned')
      setShowAssign(false)
      setSelectedTypes(new Set())
      fetchAll()
    } else {
      toast.error('Failed to assign customer types')
    }
    setAssigning(false)
  }

  const unassignType = async (type: string) => {
    if (!confirm('Remove this customer type from the offer list? Customer quantity sheets already created will stay.')) return
    const res = await fetch(`/api/offer-list/${id}/assign?customerType=${encodeURIComponent(type)}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Customer type removed'); fetchAll() }
    else toast.error('Failed to remove customer type')
  }

  if (loading || !list) {
    return <div className="p-6 text-slate-400 text-sm animate-pulse">Loading...</div>
  }

  const assignedTypes = new Set(list.assignments.map(a => a.customerType))
  const availableTypes = CUSTOMER_TYPES.filter(t => !assignedTypes.has(t))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/offer-list"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span className="font-mono">#{list.listNumber}</span>
              {list.name && <span>— {list.name}</span>}
              {list.isActive && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>}
            </h1>
            <p className="text-slate-500 text-sm">{items.length} medicines · Date: {formatDate(list.listDate)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {!list.isActive && (
            <Button size="sm" variant="outline" className="gap-1" onClick={activate}>
              <Zap size={14} /> Activate
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
          <a href={`/api/offer-list/export?id=${list.id}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" className="gap-1"><Eye size={14} /> Preview</Button>
          </a>
          <a href={`/api/offer-list/export?id=${list.id}`} download={`OfferList-${list.listNumber}.html`}>
            <Button size="sm" variant="outline" className="gap-1"><Download size={14} /> Export</Button>
          </a>
          <a href={`/api/offer-list/pdf?id=${list.id}`} target="_blank" rel="noreferrer">
            <Button size="sm" className="gap-1"><FileText size={14} /> Print PDF</Button>
          </a>
        </div>
      </div>

      {/* Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Medicines ({items.length})</CardTitle>
          {dirty && (
            <Button size="sm" onClick={saveChanges} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p className="font-medium">No medicines yet</p>
              <p className="text-sm mt-1">Hit Refresh to pull in every in-stock medicine with its current Purchase %, Offer % and Trade Price</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Code</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Medicine</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Manufacturer</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">Stock</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">Expiry</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Purchase %</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 w-24">Offer %</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 w-64">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const loss = isOfferAtLoss(item, item.specialPrice, item.purchasePrice)
                    return (
                      <tr key={item.id} className={`border-b hover:bg-slate-50 align-top ${loss ? 'bg-red-50/60' : ''}`}>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.medicine.code}</td>
                        <td className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-1.5">
                            {loss && (
                              <span title="Selling below Purchase Price — this loses money">
                                <AlertTriangle size={14} className="text-red-500 shrink-0" />
                              </span>
                            )}
                            {item.medicine.name}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{item.medicine.manufacturer.name}</td>
                        <td className="px-4 py-3 text-center">{item.stock}</td>
                        <td className="px-4 py-3 text-center text-slate-500">{item.expiryMMYY ?? '—'}</td>
                        <td className="px-4 py-3 text-right">{Number(item.purchasePercent) > 0 ? `${Number(item.purchasePercent).toFixed(2)}%` : '—'}</td>
                        <td className="px-4 py-3">
                          <Input
                            type="number" min="0" max="100" step="0.5"
                            className="w-20 h-8 text-xs text-right ml-auto"
                            value={item.offerPercent}
                            onChange={e => updateItem(item.medicineId, { offerPercent: parseFloat(e.target.value) || 0 })}
                          />
                        </td>
                        <td className="px-4 py-3 space-y-1.5">
                          <Select
                            items={COMMENT_TYPES.map(c => ({ value: c.value, label: c.label }))}
                            value={item.commentType}
                            onValueChange={v => updateItem(item.medicineId, { commentType: (v ?? 'NONE') as CommentType })}
                          >
                            <SelectTrigger size="sm" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {COMMENT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                            </SelectContent>
                          </Select>

                          {item.commentType === 'NET_PRICE' && (
                            <Input
                              type="number" min="0" step="0.01" placeholder="Net Price"
                              className="w-28 h-7 text-xs"
                              value={item.commentNetPrice ?? ''}
                              onChange={e => updateItem(item.medicineId, { commentNetPrice: e.target.value === '' ? null : parseFloat(e.target.value) })}
                            />
                          )}
                          {item.commentType === 'BONUS' && (
                            <div className="flex gap-1">
                              <Input
                                type="number" min="0" placeholder="Min Qty"
                                className="w-16 h-7 text-xs"
                                value={item.commentMinOrderQty ?? ''}
                                onChange={e => updateItem(item.medicineId, { commentMinOrderQty: e.target.value === '' ? null : parseInt(e.target.value) })}
                              />
                              <Input
                                type="number" min="0" placeholder="Qty Free"
                                className="w-16 h-7 text-xs"
                                value={item.commentQtyFree ?? ''}
                                onChange={e => updateItem(item.medicineId, { commentQtyFree: e.target.value === '' ? null : parseInt(e.target.value) })}
                              />
                            </div>
                          )}
                          {item.commentType === 'EXTRA_PERCENT' && (
                            <div className="flex gap-1">
                              <Input
                                type="number" min="0" placeholder="Min Qty"
                                className="w-16 h-7 text-xs"
                                value={item.commentMinOrderQty ?? ''}
                                onChange={e => updateItem(item.medicineId, { commentMinOrderQty: e.target.value === '' ? null : parseInt(e.target.value) })}
                              />
                              <Input
                                type="number" min="0" step="0.5" placeholder="Extra %"
                                className="w-16 h-7 text-xs"
                                value={item.commentExtraPercent ?? ''}
                                onChange={e => updateItem(item.medicineId, { commentExtraPercent: e.target.value === '' ? null : parseFloat(e.target.value) })}
                              />
                            </div>
                          )}

                          <p className="text-xs text-slate-400 italic">{formatOfferComment(item, item.expiryMMYY)}</p>
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

      {/* Assigned Customer Types */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Assigned Customer Types</CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowAssign(!showAssign)}>
            <Plus size={14} /> Assign Customer Types
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAssign && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
              {availableTypes.length === 0 ? (
                <p className="text-sm text-blue-700">All customer types are already assigned.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {availableTypes.map(t => (
                      <button
                        key={t}
                        onClick={() => toggleType(t)}
                        className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                          selectedTypes.has(t)
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={assignTypes} disabled={assigning}>
                      {assigning ? 'Assigning...' : 'Assign Selected'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setShowAssign(false); setSelectedTypes(new Set()) }}>Cancel</Button>
                  </div>
                </>
              )}
            </div>
          )}

          {list.assignments.length === 0 ? (
            <p className="text-sm text-slate-400">No customer types assigned yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {list.assignments.map(a => (
                <span key={a.customerType} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-slate-100 text-slate-700">
                  {a.customerType}
                  <button onClick={() => unassignType(a.customerType)} className="text-slate-400 hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assigned Customers */}
      <Card>
        <CardHeader><CardTitle className="text-base">Customer Quantity Sheets ({customers.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {customers.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p className="font-medium">No customers yet</p>
              <p className="text-sm mt-1">Assign a Customer Type above to generate a quantity sheet for each matching customer</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Customer</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Phone</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">Items</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">Filled</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{c.retailer.name}</td>
                      <td className="px-4 py-3 text-slate-500">{c.retailer.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-center">{c.itemCount}</td>
                      <td className="px-4 py-3 text-center">
                        {c.filledCount > 0
                          ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{c.filledCount} filled</Badge>
                          : <Badge variant="outline" className="text-slate-500">Not filled</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/offer-list/${list.id}/customers/${c.id}`}>
                          <Button size="sm" variant="outline" className="gap-1 text-xs"><Users size={12} /> Open Sheet</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
