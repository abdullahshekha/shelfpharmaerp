'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

interface CustomerGroup {
  id: string
  name: string
  createdAt: string
  _count: { members: number }
}

export default function CustomerGroupsPage() {
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchGroups = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/customer-groups')
    const json = await res.json()
    setGroups(json.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchGroups() }, [fetchGroups])

  const createGroup = async () => {
    if (!name.trim()) { toast.error('Name required'); return }
    setCreating(true)
    const res = await fetch('/api/customer-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      toast.success('Customer group created')
      setShowForm(false)
      setName('')
      fetchGroups()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to create')
    }
    setCreating(false)
  }

  const deleteGroup = async (id: string) => {
    if (!confirm('Delete this customer group? This does not affect offer lists already sent to its members.')) return
    const res = await fetch(`/api/customer-groups/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Customer group deleted'); fetchGroups() }
    else toast.error('Failed to delete')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/offer-list"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Customer Groups</h1>
            <p className="text-slate-500 text-sm">{groups.length} groups · used to assign Offer Lists to customers</p>
          </div>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowForm(!showForm)}>
          <Plus size={16} /> New Group
        </Button>
      </div>

      {showForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 space-y-4">
            <p className="font-medium text-blue-900">Create Customer Group</p>
            <div className="flex items-end gap-4">
              <div className="space-y-1.5 flex-1 max-w-sm">
                <Label>Group Name</Label>
                <Input placeholder="e.g. VIP Karachi Retailers" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <Button onClick={createGroup} disabled={creating}>{creating ? 'Creating...' : 'Create'}</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">All Groups</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-slate-400 text-sm animate-pulse">Loading...</div>
          ) : groups.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p className="font-medium">No customer groups yet</p>
              <p className="text-sm mt-1">Create a group and add customers to it, then assign offer lists to it</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                    <th className="text-center px-4 py-3 font-medium text-slate-600">Members</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => (
                    <tr key={g.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => window.location.assign(`/customer-groups/${g.id}`)}>
                      <td className="px-4 py-3 font-medium">{g.name}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-slate-600"><Users size={12} /> {g._count.members}</span>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 gap-1" onClick={() => deleteGroup(g.id)}>
                            <Trash2 size={12} />
                          </Button>
                        </div>
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
