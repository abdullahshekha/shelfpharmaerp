'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Pencil, Trash2, Check, X, MapPin } from 'lucide-react'
import { toast } from 'sonner'

interface Area { id: string; name: string; _count?: { retailers: number } }

export default function SettingsPage() {
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const fetchAreas = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/areas')
    const j = await res.json()
    // Fetch retailer counts per area
    const areasWithCount = await Promise.all(
      (j.data ?? []).map(async (a: Area) => {
        const r = await fetch(`/api/retailers?areaId=${a.id}&pageSize=1`)
        const rj = await r.json()
        return { ...a, _count: { retailers: rj.meta?.total ?? 0 } }
      })
    )
    setAreas(areasWithCount)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAreas() }, [fetchAreas])

  const addArea = async () => {
    if (!newName.trim()) { toast.error('Enter an area name'); return }
    setAdding(true)
    const res = await fetch('/api/areas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    if (res.ok) {
      toast.success('Area added')
      setNewName('')
      fetchAreas()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to add area')
    }
    setAdding(false)
  }

  const saveEdit = async (id: string) => {
    if (!editName.trim()) { toast.error('Name cannot be empty'); return }
    const res = await fetch(`/api/areas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() }),
    })
    if (res.ok) {
      toast.success('Area renamed')
      setEditId(null)
      fetchAreas()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to rename')
    }
  }

  const deleteArea = async (id: string, name: string) => {
    if (!confirm(`Delete area "${name}"? Retailers assigned to it will be unassigned.`)) return
    const res = await fetch(`/api/areas/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Area deleted')
      fetchAreas()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to delete')
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Manage reference data for the ERP</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin size={16} className="text-blue-500" />
            Areas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new area */}
          <div className="flex gap-2">
            <Input
              placeholder="New area name (e.g. PECHS, Gulshan, Clifton)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addArea()}
              className="flex-1"
            />
            <Button onClick={addArea} disabled={adding} className="gap-1">
              <Plus size={14} /> Add
            </Button>
          </div>

          {/* Area list */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : areas.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">
              No areas yet. Add your first area above.
            </p>
          ) : (
            <div className="space-y-2">
              {areas.map(area => (
                <div key={area.id} className="flex items-center gap-2 p-2.5 border rounded-lg">
                  {editId === area.id ? (
                    <>
                      <Input
                        className="flex-1 h-8 text-sm"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(area.id); if (e.key === 'Escape') setEditId(null) }}
                        autoFocus
                      />
                      <Button size="icon" className="h-8 w-8" onClick={() => saveEdit(area.id)}>
                        <Check size={14} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditId(null)}>
                        <X size={14} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium">{area.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {area._count?.retailers ?? 0} retailer{(area._count?.retailers ?? 0) !== 1 ? 's' : ''}
                      </Badge>
                      <Button
                        size="icon" variant="ghost" className="h-8 w-8"
                        onClick={() => { setEditId(area.id); setEditName(area.name) }}
                      >
                        <Pencil size={13} />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => deleteArea(area.id, area.name)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
