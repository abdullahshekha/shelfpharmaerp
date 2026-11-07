'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import AuditTable from './AuditTable'
import type { AuditRow } from './AuditChanges'

/** Admin-only, lazy: nothing is fetched until the card is expanded. Hides itself on 403. */
export default function OrderHistory({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && rows === null && !loading) {
      setLoading(true); setError('')
      try {
        const res = await fetch(`/api/orders/${orderId}/history`)
        if (res.status === 403 || res.status === 401) { setHidden(true); return }
        if (!res.ok) { setError('Could not load history.'); return }
        const j = await res.json()
        setRows(Array.isArray(j.data) ? j.data : [])
      } catch { setError('Could not load history.') } finally { setLoading(false) }
    }
  }

  if (hidden) return null
  return (
    <Card>
      <CardHeader className="py-3">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex items-center gap-2 text-left w-full">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <History className="h-4 w-4 text-slate-500" />
          <CardTitle className="text-base">History</CardTitle>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {rows && rows.length === 0 && <p className="text-sm text-slate-500">No recorded changes for this order.</p>}
          {rows && rows.length > 0 && <AuditTable rows={rows} />}
        </CardContent>
      )}
    </Card>
  )
}
