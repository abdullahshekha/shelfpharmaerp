'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Search, X } from 'lucide-react'
import { toast } from 'sonner'

interface Member {
  retailer: { id: string; name: string; phone: string | null; ownerName: string | null }
}

interface Group {
  id: string
  name: string
  members: Member[]
}

interface RetailerResult { id: string; name: string; phone: string | null }

export default function CustomerGroupDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [group, setGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<RetailerResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)

  const fetchGroup = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/customer-groups/${id}`)
    const json = await res.json()
    setGroup(json.data ?? null)
    setLoading(false)
  }, [id])

  useEffect(() => { fetchGroup() }, [fetchGroup])

  useEffect(() => {
    if (!search) { setResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/retailers?search=${encodeURIComponent(search)}&pageSize=8`)
      const j = await res.json()
      setResults(j.data ?? [])
      setShowDropdown(true)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const memberIds = new Set(group?.members.map(m => m.retailer.id) ?? [])

  const addMember = async (retailerId: string) => {
    const res = await fetch(`/api/customer-groups/${id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retailerId }),
    })
    if (res.ok) {
      setSearch('')
      setShowDropdown(false)
      fetchGroup()
    } else {
      toast.error('Failed to add customer')
    }
  }

  const removeMember = async (retailerId: string) => {
    const res = await fetch(`/api/customer-groups/${id}/members?retailerId=${retailerId}`, { method: 'DELETE' })
    if (res.ok) fetchGroup()
    else toast.error('Failed to remove customer')
  }

  if (loading || !group) {
    return <div className="p-6 text-slate-400 text-sm animate-pulse">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/customer-groups"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <p className="text-slate-500 text-sm">{group.members.length} customers</p>
        </div>
      </div>

      <Card className="overflow-visible">
        <CardHeader><CardTitle className="text-base">Add Customers</CardTitle></CardHeader>
        <CardContent>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search customer by name or phone..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            />
            {showDropdown && results.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {results.map(r => (
                  <button
                    key={r.id}
                    disabled={memberIds.has(r.id)}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 ${
                      memberIds.has(r.id) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'
                    }`}
                    onMouseDown={() => addMember(r.id)}
                  >
                    <span className="font-medium">{r.name}</span>
                    {memberIds.has(r.id)
                      ? <span className="text-xs text-slate-400">Already in group</span>
                      : <span className="text-xs text-slate-400">{r.phone ?? ''}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Members</CardTitle></CardHeader>
        <CardContent className="p-0">
          {group.members.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p className="font-medium">No customers in this group yet</p>
              <p className="text-sm mt-1">Search above to add customers</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Owner</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Phone</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {group.members.map(m => (
                    <tr key={m.retailer.id} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{m.retailer.name}</td>
                      <td className="px-4 py-3 text-slate-500">{m.retailer.ownerName ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{m.retailer.phone ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeMember(m.retailer.id)}>
                            <X size={14} className="text-red-400" />
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
