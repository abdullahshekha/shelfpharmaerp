'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate } from '@/lib/utils/format'
import { Plus, Eye, Zap, Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface OfferList {
  id: string
  listNumber: string
  listDate: string
  isActive: boolean
  createdAt: string
  _count: { items: number }
}

export default function OfferListPage() {
  const [lists, setLists] = useState<OfferList[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [listDate, setListDate] = useState(new Date().toISOString().slice(0, 10))

  const fetchLists = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/offer-list')
    const json = await res.json()
    setLists(json.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchLists() }, [fetchLists])

  const createList = async () => {
    setCreating(true)
    const res = await fetch('/api/offer-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listDate }),
    })
    if (res.ok) {
      toast.success('Offer list created')
      setShowForm(false)
      fetchLists()
    } else {
      toast.error('Failed to create')
    }
    setCreating(false)
  }

  const deleteList = async (id: string, isActive: boolean) => {
    if (isActive) { toast.error('Cannot delete the active offer list. Activate another list first.'); return }
    if (!confirm('Delete this offer list?')) return
    const res = await fetch(`/api/offer-list/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Offer list deleted'); fetchLists() }
    else toast.error('Failed to delete')
  }

  const activate = async (id: string) => {
    const res = await fetch(`/api/offer-list/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    })
    if (res.ok) {
      toast.success('Offer list activated')
      fetchLists()
    } else {
      toast.error('Failed to activate')
    }
  }

  const activeList = lists.find(l => l.isActive)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Offer List</h1>
          <p className="text-slate-500 text-sm">{lists.length} lists</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> New Offer List
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 space-y-4">
            <p className="font-medium text-blue-900">Create New Offer List</p>
            <div className="flex items-end gap-4">
              <div className="space-y-1.5">
                <Label>List Date</Label>
                <Input type="date" value={listDate} onChange={e => setListDate(e.target.value)} className="w-44" />
              </div>
              <Button onClick={createList} disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
            <p className="text-xs text-blue-700">
              List number is auto-assigned. After creation, go to the list to add medicines and set offers.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Active list banner */}
      {activeList && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-green-900 flex items-center gap-2">
                <Zap size={16} className="text-green-600" />
                Active List: <span className="font-mono">#{activeList.listNumber}</span>
              </p>
              <p className="text-sm text-green-700">
                {activeList._count.items} medicines · Date: {formatDate(activeList.listDate)}
              </p>
            </div>
            <div className="flex gap-2">
              <a href={`/api/offer-list/export?id=${activeList.id}`} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline" className="gap-1">
                  <Eye size={14} /> Preview
                </Button>
              </a>
              <a href={`/api/offer-list/export?id=${activeList.id}`} download={`OfferList-${activeList.listNumber}.html`}>
                <Button size="sm" className="gap-1">
                  <Download size={14} /> Export HTML
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* All lists table */}
      <Card>
        <CardHeader><CardTitle className="text-base">All Offer Lists</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-slate-400 text-sm animate-pulse">Loading...</div>
          ) : lists.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p className="font-medium">No offer lists yet</p>
              <p className="text-sm mt-1">Create your first offer list to get started</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">List #</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Items</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {lists.map(list => (
                  <tr key={list.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold">{list.listNumber}</td>
                    <td className="px-4 py-3">{formatDate(list.listDate)}</td>
                    <td className="px-4 py-3 text-center">{list._count.items}</td>
                    <td className="px-4 py-3 text-center">
                      {list.isActive
                        ? <Badge className="bg-green-100 text-green-800">Active</Badge>
                        : <Badge variant="outline" className="text-slate-500">Inactive</Badge>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <a href={`/api/offer-list/export?id=${list.id}`} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="ghost" className="gap-1 text-xs"><Eye size={12} /> Preview</Button>
                        </a>
                        {!list.isActive && (
                          <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => activate(list.id)}>
                            <Zap size={12} /> Activate
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 gap-1" onClick={() => deleteList(list.id, list.isActive)}>
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-slate-50">
        <CardContent className="pt-4 text-sm text-slate-600 space-y-1">
          <p className="font-medium">How to set up an offer list:</p>
          <ol className="list-decimal ml-4 space-y-1 text-slate-500">
            <li>Create a new list (auto-numbers from the last one)</li>
            <li>Hit <strong>Preview</strong> — all 787 medicines appear at their stored trade prices and offers</li>
            <li>To customise per-medicine offer %, use the PUT /api/offer-list/[id] endpoint with an items array</li>
            <li>Click <strong>Activate</strong> to make it the live list (deactivates any previous active list)</li>
            <li><strong>Export HTML</strong> downloads a standalone file matching the original OfferList.html format exactly</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
