'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { roleLabel } from '@/lib/constants'
import type { Assignee } from './types'

interface Props {
  open: boolean
  title: string
  description?: string
  assignees: Assignee[]
  busy?: boolean
  confirmLabel?: string
  onClose: () => void
  onConfirm: (assigneeId: string) => void
}

const label = (a: Assignee) => (a.role ? `${a.name} (${roleLabel(a.role)})` : a.name)

/** Pick who a delivery (or several) is assigned to. Assigning sends the stock out, so the person is required. */
export function AssignDialog({ open, title, description, assignees, busy, confirmLabel = 'Assign', onClose, onConfirm }: Props) {
  const [id, setId] = useState('')
  useEffect(() => { if (open) setId('') }, [open])
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? 'Assigning sends the stock out for delivery.'}</DialogDescription>
        </DialogHeader>
        <Select items={assignees.map(a => ({ value: a.id, label: label(a) }))} value={id} onValueChange={v => setId(v ?? '')}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Choose a person" /></SelectTrigger>
          <SelectContent>
            {assignees.map(a => <SelectItem key={a.id} value={a.id}>{label(a)}</SelectItem>)}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(id)} disabled={!id || busy}>{busy ? 'Working...' : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
