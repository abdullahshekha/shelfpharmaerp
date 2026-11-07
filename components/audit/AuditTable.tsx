'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatDateTime } from '@/lib/utils/format'
import AuditChanges, { summarize, type AuditRow } from './AuditChanges'

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-800',
  LOGIN: 'bg-slate-100 text-slate-700',
  LOGIN_FAILED: 'bg-amber-100 text-amber-800',
}

export default function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left text-slate-600">
            <th className="px-3 py-2 font-medium whitespace-nowrap">Time (Karachi)</th>
            <th className="px-3 py-2 font-medium">User</th>
            <th className="px-3 py-2 font-medium">Table</th>
            <th className="px-3 py-2 font-medium">Record</th>
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium">Changes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.id)
            const cls = ACTION_COLORS[r.action] ?? (r.action.startsWith('BULK_') ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700')
            return (
              <tr key={r.id} className="border-b align-top">
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.actorName ?? r.actorType}</div>
                  {r.actorRole && <div className="text-xs text-slate-400">{r.actorRole}</div>}
                </td>
                <td className="px-3 py-2">{r.model}</td>
                <td className="px-3 py-2 font-mono text-xs break-all max-w-[180px]">{r.recordId}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{r.action}</span></td>
                <td className="px-3 py-2 min-w-[220px]">
                  <button type="button" onClick={() => toggle(r.id)} aria-expanded={isOpen}
                    className="flex items-start gap-1 text-left text-xs text-slate-600 hover:text-slate-900">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                    {!isOpen && <span>{summarize(r.action, r.changes)}</span>}
                  </button>
                  {isOpen && <div className="mt-1 pl-5"><AuditChanges action={r.action} changes={r.changes} reason={r.reason} /></div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
