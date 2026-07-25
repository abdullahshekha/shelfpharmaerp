'use client'

import { useState, useEffect, useCallback, ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { toast } from 'sonner'

interface Item {
  id: string
  name: string
  contact?: string | null
  [key: string]: unknown
}

interface Props {
  title: string
  icon: ReactNode
  apiPath: string
  addPlaceholder: string
  countField?: string
  countLabel?: (n: number) => string
  withContact?: boolean
}

export function ReferenceListManager({ title, icon, apiPath, addPlaceholder, countField, countLabel, withContact }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newContact, setNewContact] = useState('')
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editContact, setEditContact] = useState('')

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const res = await fetch(apiPath)
    const j = await res.json()
    setItems(j.data ?? [])
    setLoading(false)
  }, [apiPath])

  useEffect(() => { fetchItems() }, [fetchItems])

  const addItem = async () => {
    if (!newName.trim()) { toast.error('Enter a name'); return }
    setAdding(true)
    const res = await fetch(apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withContact ? { name: newName.trim(), contact: newContact.trim() } : { name: newName.trim() }),
    })
    if (res.ok) {
      toast.success(`${title.replace(/s$/, '')} added`)
      setNewName('')
      setNewContact('')
      fetchItems()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to add')
    }
    setAdding(false)
  }

  const saveEdit = async (id: string) => {
    if (!editName.trim()) { toast.error('Name cannot be empty'); return }
    const res = await fetch(`${apiPath}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withContact ? { name: editName.trim(), contact: editContact.trim() } : { name: editName.trim() }),
    })
    if (res.ok) {
      toast.success('Renamed')
      setEditId(null)
      fetchItems()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to rename')
    }
  }

  const deleteItem = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    const res = await fetch(`${apiPath}/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Deleted')
      fetchItems()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to delete')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder={addPlaceholder}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !withContact && addItem()}
            className="flex-1"
          />
          {withContact && (
            <Input
              placeholder="Contact (optional)"
              value={newContact}
              onChange={e => setNewContact(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              className="flex-1"
            />
          )}
          <Button onClick={addItem} disabled={adding} className="gap-1">
            <Plus size={14} /> Add
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">
            None yet. Add the first one above.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <div key={item.id} className="flex items-center gap-2 p-2.5 border rounded-lg">
                {editId === item.id ? (
                  <>
                    <Input
                      className="flex-1 h-8 text-sm"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(item.id); if (e.key === 'Escape') setEditId(null) }}
                      autoFocus
                    />
                    {withContact && (
                      <Input
                        className="flex-1 h-8 text-sm"
                        placeholder="Contact"
                        value={editContact}
                        onChange={e => setEditContact(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(item.id); if (e.key === 'Escape') setEditId(null) }}
                      />
                    )}
                    <Button size="icon" className="h-8 w-8" onClick={() => saveEdit(item.id)}>
                      <Check size={14} />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditId(null)}>
                      <X size={14} />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium">{item.name}</span>
                    {withContact && item.contact && (
                      <span className="text-xs text-slate-400">{item.contact}</span>
                    )}
                    {countField && countLabel && (
                      <Badge variant="outline" className="text-xs">
                        {countLabel(Number(item[countField] ?? 0))}
                      </Badge>
                    )}
                    <Button
                      size="icon" variant="ghost" className="h-8 w-8"
                      onClick={() => { setEditId(item.id); setEditName(item.name); setEditContact(item.contact ?? '') }}
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => deleteItem(item.id, item.name)}
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
  )
}
