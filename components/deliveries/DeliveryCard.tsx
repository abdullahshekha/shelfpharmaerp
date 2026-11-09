'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPKR, formatDate } from '@/lib/utils/format'
import type { BoardColumn } from '@/lib/orders/status'
import type { CardAction } from '@/lib/deliveries/ui-helpers'
import { Truck, UserPlus, Repeat, Undo2, ClipboardCheck, AlertCircle } from 'lucide-react'
import { OUTCOME_LABEL, type BoardDelivery } from './types'

interface Props {
  delivery: BoardDelivery
  column: BoardColumn
  actions: CardAction[]
  busy?: boolean
  selectable?: boolean
  selected?: boolean
  onToggle?: () => void
  onAction: (a: CardAction) => void
}

export function DeliveryCard({ delivery: d, column, actions, busy, selectable, selected, onToggle, onAction }: Props) {
  const amount = d.order.invoice?.totalAmount ?? d.order.totalAmount
  const onHold = d.order.status === 'ON_HOLD'
  // A held order whose date has arrived is back in Ready to Dispatch; keep the reason visible there.
  const holdNote = d.outcome === 'ON_HOLD' && (column === 'ON_HOLD' || (column === 'READY' && onHold))
  return (
    <div className={`rounded-lg border bg-white p-3 space-y-2 shadow-sm ${selected ? 'ring-2 ring-blue-400' : ''}`}>
      <div className="flex items-start gap-2">
        {selectable && (
          <input type="checkbox" className="mt-1 h-4 w-4 print:hidden" checked={!!selected} onChange={onToggle} aria-label="Select delivery" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{d.order.retailer.name}</div>
          <div className="text-xs text-slate-500">
            {d.order.retailer.area?.name ?? 'No area'} · <span className="font-mono">{d.order.orderNumber}</span>
          </div>
          {d.order.retailer.address && <div className="text-xs text-slate-400 truncate">{d.order.retailer.address}</div>}
        </div>
        <div className="text-sm font-semibold whitespace-nowrap">{formatPKR(amount)}</div>
      </div>

      {(d.driver || column === 'ASSIGNED') && (
        <div className="flex items-center gap-2 text-xs">
          <Truck size={12} className="text-slate-400" />
          <span className={d.driver ? 'text-slate-700' : 'text-slate-400'}>{d.driver?.name ?? 'Unassigned'}</span>
        </div>
      )}

      {holdNote && (
        <div className="flex items-start gap-1.5 rounded bg-yellow-50 border border-yellow-200 p-1.5 text-xs text-yellow-800">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            {column === 'ON_HOLD' ? `Held until ${formatDate(d.scheduledDate)}` : `Was on hold, due ${formatDate(d.scheduledDate)}`}
            {d.outcomeReason ? `: ${d.outcomeReason}` : ''}
          </span>
        </div>
      )}

      {(column === 'DELIVERED' || column === 'RETURNED') && d.outcome && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="outline" className="text-[11px]">{OUTCOME_LABEL[d.outcome] ?? d.outcome}</Badge>
          {d.outcomeReason && <span className="text-slate-600">{d.outcomeReason}</span>}
          {d.outcomeAt && <span className="text-slate-400">{formatDate(d.outcomeAt)}</span>}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 print:hidden">
          {actions.includes('assign') && (
            <Button size="sm" variant="outline" className="text-xs gap-1" disabled={busy} onClick={() => onAction('assign')}>
              <UserPlus size={12} /> Assign
            </Button>
          )}
          {actions.includes('outcome') && (
            <Button size="sm" className="text-xs gap-1" disabled={busy} onClick={() => onAction('outcome')}>
              <ClipboardCheck size={12} /> Record outcome
            </Button>
          )}
          {actions.includes('reassign') && (
            <Button size="sm" variant="outline" className="text-xs gap-1" disabled={busy} onClick={() => onAction('reassign')}>
              <Repeat size={12} /> Reassign
            </Button>
          )}
          {actions.includes('unassign') && (
            <Button size="sm" variant="outline" className="text-xs gap-1 text-red-700 border-red-300 hover:bg-red-50" disabled={busy} onClick={() => onAction('unassign')}>
              <Undo2 size={12} /> Un-assign
            </Button>
          )}
        </div>
      )}

      <div className="hidden print:block text-xs mt-1">Delivered: [ ] &nbsp;&nbsp; Signature: _______________</div>
    </div>
  )
}
