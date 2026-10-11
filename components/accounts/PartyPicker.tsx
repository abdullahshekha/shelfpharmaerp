/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

export interface Party { id: string; name: string }

interface Props {
  kind: 'customer' | 'supplier'
  value: Party | null
  onChange: (p: Party | null) => void
}

/** Searchable customer (via /api/retailers?search=) or supplier (loaded once, filtered client-side) picker. */
export function PartyPicker({ kind, value, onChange }: Props) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Party[]>([])
  const [open, setOpen] = useState(false)
  const suppliers = useRef<Party[] | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        if (kind === 'supplier') {
          if (!suppliers.current) {
            const j = await (await fetch('/api/suppliers')).json()
            suppliers.current = (j.data ?? []).map((s: any) => ({ id: s.id, name: s.name }))
          }
          const needle = q.trim().toLowerCase()
          const list = suppliers.current!.filter(s => !needle || s.name.toLowerCase().includes(needle))
          if (!cancelled) setResults(list.slice(0, 20))
        } else {
          const j = await (await fetch(`/api/retailers?search=${encodeURIComponent(q.trim())}&pageSize=20`)).json()
          if (!cancelled) setResults((j.data ?? []).map((r: any) => ({ id: r.id, name: r.name })))
        }
      } catch {
        if (!cancelled) setResults([])
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, open, kind])

  if (value) {
    return (
      <div className="flex items-center gap-1 h-8 px-2 rounded-md border bg-slate-50 text-sm">
        <span className="truncate max-w-[10rem]">{value.name}</span>
        <Button type="button" variant="ghost" size="icon-sm" className="h-5 w-5" onClick={() => onChange(null)}>
          <X size={12} />
        </Button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Input
        className="h-8 text-sm w-44"
        placeholder={kind === 'customer' ? 'Search customer…' : 'Search supplier…'}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-[60] mt-1 w-60 max-h-48 overflow-auto rounded-md border bg-white shadow-md">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">No matches</p>
          ) : results.map(r => (
            <button
              type="button"
              key={r.id}
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100"
              onMouseDown={e => { e.preventDefault(); onChange(r); setQ(''); setOpen(false) }}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
