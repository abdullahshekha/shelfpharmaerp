'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Pencil, Trash2, Check, X, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { WEEKDAYS, type BookingDay } from '@/lib/utils/area-schedule'

interface Area {
  id: string
  name: string
  deliveryDays: number[]
  bookingDays: BookingDay[] | null
  _count?: { retailers: number }
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`
const short = (d: number) => WEEKDAYS[d].slice(0, 3)

export default function AreasSettingsPage() {
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDelivery, setEditDelivery] = useState<number[]>([])
  const [editBooking, setEditBooking] = useState<Record<number, number>>({}) // day -> cut-off hour

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
      toast.success('Area added — use the pencil to set its booking and delivery days')
      setNewName('')
      fetchAreas()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to add area')
    }
    setAdding(false)
  }

  const startEdit = (area: Area) => {
    setEditId(area.id)
    setEditName(area.name)
    setEditDelivery(area.deliveryDays ?? [])
    setEditBooking(Object.fromEntries((area.bookingDays ?? []).map(b => [b.day, b.cutoffHour])))
  }

  const toggleDelivery = (d: number) =>
    setEditDelivery(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]))

  const toggleBooking = (d: number) =>
    setEditBooking(prev => {
      const next = { ...prev }
      if (d in next) delete next[d]
      else next[d] = 17
      return next
    })

  const saveEdit = async (id: string) => {
    if (!editName.trim()) { toast.error('Name cannot be empty'); return }
    const res = await fetch(`/api/areas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editName.trim(),
        deliveryDays: editDelivery,
        bookingDays: Object.entries(editBooking).map(([day, cutoffHour]) => ({ day: Number(day), cutoffHour })),
      }),
    })
    if (res.ok) {
      toast.success('Area saved')
      setEditId(null)
      fetchAreas()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to save')
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
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Areas</h1>
        <p className="text-slate-500 text-sm mt-1">Delivery areas customers are assigned to, with their booking and delivery days</p>
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
                <div key={area.id} className="p-2.5 border rounded-lg space-y-3">
                  {editId === area.id ? (
                    <>
                      <div className="flex items-center gap-2">
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
                      </div>
                      <div className="overflow-x-auto">
                        <table className="text-sm w-full">
                          <thead>
                            <tr className="text-xs text-slate-500">
                              <th className="text-left font-medium py-1 pr-3">Day</th>
                              <th className="font-medium py-1 px-3">Delivery</th>
                              <th className="font-medium py-1 px-3">Booking</th>
                              <th className="text-left font-medium py-1 px-3">Booking cut-off (hour, 0–23)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {WEEKDAYS.map((name, d) => (
                              <tr key={d} className="border-t">
                                <td className="py-1.5 pr-3">{name}</td>
                                <td className="text-center px-3">
                                  <input type="checkbox" checked={editDelivery.includes(d)} onChange={() => toggleDelivery(d)} />
                                </td>
                                <td className="text-center px-3">
                                  <input type="checkbox" checked={d in editBooking} onChange={() => toggleBooking(d)} />
                                </td>
                                <td className="px-3">
                                  {d in editBooking && (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        type="number" min={0} max={23}
                                        className="h-7 w-16 text-sm"
                                        value={editBooking[d]}
                                        onChange={e => {
                                          const h = Math.min(23, Math.max(0, parseInt(e.target.value || '0', 10) || 0))
                                          setEditBooking(prev => ({ ...prev, [d]: h }))
                                        }}
                                      />
                                      <span className="text-xs text-slate-400">{hourLabel(editBooking[d])}</span>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-slate-400">
                        Orders placed after the cut-off hour on a booking day roll over to the next booking day.
                        Confirmed orders are scheduled for the area&apos;s next delivery day.
                      </p>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{area.name}</span>
                        <div className="text-xs text-slate-500 mt-0.5 space-y-0.5">
                          <div>
                            Delivery: {area.deliveryDays?.length
                              ? area.deliveryDays.map(short).join(', ')
                              : <span className="text-slate-400">not set</span>}
                          </div>
                          <div>
                            Booking: {area.bookingDays?.length
                              ? area.bookingDays.map(b => `${short(b.day)} till ${hourLabel(b.cutoffHour)}`).join(', ')
                              : <span className="text-slate-400">not set</span>}
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {area._count?.retailers ?? 0} retailer{(area._count?.retailers ?? 0) !== 1 ? 's' : ''}
                      </Badge>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(area)}>
                        <Pencil size={13} />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => deleteArea(area.id, area.name)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
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
