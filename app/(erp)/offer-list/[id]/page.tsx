'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatPKR } from '@/lib/utils/format'
import { ArrowLeft, Eye, Download, Zap, RefreshCw, Users, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

interface Medicine {
  id: string
  code: string
  name: string
  manufacturer: { name: string }
  batches: { currentQty: number }[]
}

interface OfferListItem {
  id: string
  medicineId: string
  medicine: Medicine
  offerPercent: number
  bonusQty: number
  specialPrice: number | null
  salesTax: number
}

interface CustomerGroupRef { id: string; name: string }

interface OfferListDetail {
  id: string
  name: string | null
  listNumber: string
  listDate: string
  isActive: boolean
  items: OfferListItem[]
  assignments: { customerGroup: CustomerGroupRef }[]
  _count: { customers: number }
}

interface CustomerGroup { id: string; name: string; _count: { members: number } }

interface AssignedCustomer {
  id: string
  retailer: { id: string; name: string; phone: string | null }
  itemCount: number
  filledCount: number
}

export default function OfferListDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [list, setList] = useState<OfferListDetail | null>(null)
  const [customers, setCustomers] = useState<AssignedCustomer[]>([])
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [listRes, customersRes, groupsRes] = await Promise.all([
      fetch(`/api/offer-list/${id}`),
      fetch(`/api/offer-list/${id}/customers`),
      fetch('/api/customer-groups'),
    ])
    const listJson = await listRes.json()
    setList(listJson.data ?? null)
    setCustomers((await customersRes.json()).data ?? [])
    setGroups((await groupsRes.json()).data ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => { fetchAll() }, [fetchAll])

  const refresh = async () => {
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

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const assignGroups = async () => {
    if (selectedGroupIds.size === 0) { toast.error('Select at least one group'); return }
    setAssigning(true)
    const res = await fetch(`/api/offer-list/${id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerGroupIds: Array.from(selectedGroupIds) }),
    })
    if (res.ok) {
      toast.success('Groups assigned')
      setShowAssign(false)
      setSelectedGroupIds(new Set())
      fetchAll()
    } else {
      toast.error('Failed to assign groups')
    }
    setAssigning(false)
  }

  const unassignGroup = async (groupId: string) => {
    if (!confirm('Remove this group from the offer list? Customer quantity sheets already created will stay.')) return
    const res = await fetch(`/api/offer-list/${id}/assign?customerGroupId=${groupId}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Group removed'); fetchAll() }
    else toast.error('Failed to remove group')
  }

  if (loading || !list) {
    return <div className="p-6 text-slate-400 text-sm animate-pulse">Loading...</div>
  }

  const assignedGroupIds = new Set(list.assignments.map(a => a.customerGroup.id))
  const availableGroups = groups.filter(g => !assignedGroupIds.has(g.id))

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
            <p className="text-slate-500 text-sm">{list.items.length} medicines · Date: {formatDate(list.listDate)}</p>
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
            <Button size="sm" className="gap-1"><Download size={14} /> Export</Button>
          </a>
        </div>
      </div>

      {/* Items */}
      <Card>
        <CardHeader><CardTitle className="text-base">Medicines ({list.items.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {list.items.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p className="font-medium">No medicines yet</p>
              <p className="text-sm mt-1">Hit Refresh to pull in every in-stock medicine with its current Offer %, Bonus and Trade Price</p>
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
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Offer %</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Bonus</th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600">T.P</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map(item => {
                    const stock = item.medicine.batches.reduce((s, b) => s + b.currentQty, 0)
                    return (
                      <tr key={item.id} className="border-b hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.medicine.code}</td>
                        <td className="px-4 py-3 font-medium">{item.medicine.name}</td>
                        <td className="px-4 py-3 text-slate-500">{item.medicine.manufacturer.name}</td>
                        <td className="px-4 py-3 text-center">{stock}</td>
                        <td className="px-4 py-3 text-right">{Number(item.offerPercent) > 0 ? `${Number(item.offerPercent).toFixed(2)}%` : '—'}</td>
                        <td className="px-4 py-3 text-right">{item.bonusQty > 0 ? item.bonusQty : '—'}</td>
                        <td className="px-4 py-3 text-right font-medium">{item.specialPrice != null ? formatPKR(item.specialPrice) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assigned Customer Groups */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Assigned Customer Groups</CardTitle>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowAssign(!showAssign)}>
            <Plus size={14} /> Assign Groups
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAssign && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
              {availableGroups.length === 0 ? (
                <p className="text-sm text-blue-700">
                  {groups.length === 0
                    ? <>No customer groups exist yet. <Link href="/customer-groups" className="underline">Create one</Link> first.</>
                    : 'All existing groups are already assigned.'}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {availableGroups.map(g => (
                      <button
                        key={g.id}
                        onClick={() => toggleGroup(g.id)}
                        className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                          selectedGroupIds.has(g.id)
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        {g.name} <span className="opacity-70">({g._count.members})</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={assignGroups} disabled={assigning}>
                      {assigning ? 'Assigning...' : 'Assign Selected'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setShowAssign(false); setSelectedGroupIds(new Set()) }}>Cancel</Button>
                  </div>
                </>
              )}
            </div>
          )}

          {list.assignments.length === 0 ? (
            <p className="text-sm text-slate-400">No groups assigned yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {list.assignments.map(a => (
                <span key={a.customerGroup.id} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-slate-100 text-slate-700">
                  {a.customerGroup.name}
                  <button onClick={() => unassignGroup(a.customerGroup.id)} className="text-slate-400 hover:text-red-500">
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
              <p className="text-sm mt-1">Assign a Customer Group above to generate a quantity sheet for each of its members</p>
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
