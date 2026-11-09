'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PartyPicker, type Party } from '@/components/accounts/PartyPicker'
import { toDateInput, todayKarachi } from '@/components/accounts/types'
import { canCreateCheque, canEditParty } from '@/lib/pdc/guard'
import type { ChequeDirection } from '@/lib/pdc/rules'
import type { Bank, Cheque } from './ChequeTable'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  role: string
  banks: Bank[]
  /** Edit an existing cheque; omitted = "Add cheque". */
  cheque?: Cheque | null
  /** From canEditCheque(): 'NOTES' = cleared cheque, only notes editable. */
  editMode?: 'FULL' | 'NOTES'
  defaultDirection?: ChequeDirection
  onSaved: () => void
}

type FormState = {
  direction: ChequeDirection
  party: Party | null
  chequeNumber: string
  amount: string
  chequeDate: string
  receivedDate: string
  bankAccountId: string
  drawerBank: string
  notes: string
}

function initial(cheque: Cheque | null | undefined, direction: ChequeDirection): FormState {
  if (!cheque) {
    return {
      direction, party: null, chequeNumber: '', amount: '', chequeDate: todayKarachi(), receivedDate: todayKarachi(),
      bankAccountId: '', drawerBank: '', notes: '',
    }
  }
  const p = cheque.retailer ?? cheque.supplier
  return {
    direction: cheque.direction,
    party: p ? { id: p.id, name: p.name } : null,
    chequeNumber: cheque.chequeNumber,
    amount: String(Number(cheque.amount)),
    chequeDate: toDateInput(cheque.chequeDate),
    receivedDate: toDateInput(cheque.receivedDate),
    bankAccountId: cheque.bankAccountId ?? '',
    drawerBank: cheque.drawerBank ?? '',
    notes: cheque.notes ?? '',
  }
}

/** Add a cheque (POST /api/cheques) or edit one (PATCH /api/cheques/[id], only the fields that changed). */
export function ChequeForm({ open, onOpenChange, role, banks, cheque, editMode = 'FULL', defaultDirection = 'RECEIVABLE', onSaved }: Props) {
  const editing = !!cheque
  const notesOnly = editing && editMode === 'NOTES'
  const partyEditable = !editing || canEditParty(role)
  const [f, setF] = useState<FormState>(() => initial(cheque, defaultDirection))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)

  const startDirection: ChequeDirection = canCreateCheque(role, defaultDirection) ? defaultDirection : 'RECEIVABLE'
  useEffect(() => {
    if (open) { setF(initial(cheque, startDirection)); setError('') }
  }, [open, cheque, startDirection])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))
  const activeBanks = banks.filter((b) => b.isActive || b.id === f.bankAccountId)
  const directions = (['RECEIVABLE', 'PAYABLE'] as ChequeDirection[]).filter((d) => canCreateCheque(role, d))

  const submit = async () => {
    if (busy.current) return
    setError('')
    let body: Record<string, unknown>
    if (notesOnly) {
      body = { notes: f.notes }
    } else {
      if (!f.party) return setError(f.direction === 'RECEIVABLE' ? 'Choose the customer' : 'Choose the supplier')
      if (!f.chequeNumber.trim()) return setError('Enter the cheque number')
      if (!/^\d+(\.\d{1,2})?$/.test(f.amount.trim()) || !(Number(f.amount) > 0)) return setError('Enter an amount greater than zero (max 2 decimals)')
      if (!f.chequeDate) return setError('Enter the cheque date')
      const full: Record<string, unknown> = {
        chequeNumber: f.chequeNumber.trim(),
        amount: f.amount.trim(),
        chequeDate: f.chequeDate,
        receivedDate: f.receivedDate || undefined,
        bankAccountId: f.bankAccountId || null,
        drawerBank: f.drawerBank,
        notes: f.notes,
      }
      if (!editing) {
        body = {
          ...full,
          direction: f.direction,
          retailerId: f.direction === 'RECEIVABLE' ? f.party.id : null,
          supplierId: f.direction === 'PAYABLE' ? f.party.id : null,
        }
      } else {
        // Send only what changed: a salesman may not send party fields at all.
        const before = initial(cheque, cheque!.direction)
        body = {}
        for (const k of ['chequeNumber', 'chequeDate', 'receivedDate', 'drawerBank', 'notes'] as const) {
          if (f[k] !== before[k]) body[k] = full[k]
        }
        if (Number(f.amount) !== Number(before.amount)) body.amount = full.amount
        if (f.bankAccountId !== before.bankAccountId) body.bankAccountId = full.bankAccountId
        if (partyEditable && f.party.id !== before.party?.id) {
          if (f.direction === 'RECEIVABLE') body.retailerId = f.party.id
          else body.supplierId = f.party.id
        }
        if (Object.keys(body).length === 0) { onOpenChange(false); return }
      }
    }
    busy.current = true
    setSaving(true)
    try {
      const send = async (b: Record<string, unknown>) => {
        const res = await fetch(editing ? `/api/cheques/${cheque!.id}` : '/api/cheques', {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(b),
        })
        return { res, j: await res.json().catch(() => ({})) }
      }
      let { res, j } = await send(body)
      // Same number already recorded for this party: only a deliberate "Record anyway" resends with allowDuplicate.
      if (res.status === 409 && j.duplicate) {
        if (!confirm(`${j.error}.

Record anyway? (only if it is a different cheque with the same number)`)) {
          setError(j.error)
          return
        }
        ;({ res, j } = await send({ ...body, allowDuplicate: true }))
      }
      if (!res.ok) { setError(j.error ?? 'Could not save the cheque'); return }
      toast.success(editing ? 'Cheque updated' : 'Cheque recorded as Pending')
      onOpenChange(false)
      onSaved()
    } catch {
      setError('Network error — reload the list before retrying')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  const disabled = notesOnly
  const bankItems = [{ value: 'none', label: 'Not chosen yet' }, ...activeBanks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}${b.isActive ? '' : ' (inactive)'}` }))]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit cheque ${cheque!.chequeNumber}` : 'Add cheque'}</DialogTitle>
          <DialogDescription>
            {notesOnly
              ? 'This cheque is cleared: only the notes can change.'
              : 'A new cheque stays Pending and changes no balance until it is cleared.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Direction</Label>
            {editing || directions.length < 2 ? (
              <p className="h-8 flex items-center text-sm">{f.direction === 'RECEIVABLE' ? 'Receivable (from customer)' : 'Payable (to supplier)'}</p>
            ) : (
              <Select
                items={[{ value: 'RECEIVABLE', label: 'Receivable (from customer)' }, { value: 'PAYABLE', label: 'Payable (to supplier)' }]}
                value={f.direction}
                onValueChange={(v) => setF((s) => ({ ...s, direction: (v as ChequeDirection) ?? 'RECEIVABLE', party: null }))}
              >
                <SelectTrigger className="w-full h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECEIVABLE">Receivable (from customer)</SelectItem>
                  <SelectItem value="PAYABLE">Payable (to supplier)</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{f.direction === 'RECEIVABLE' ? 'Customer *' : 'Supplier *'}</Label>
            {disabled || !partyEditable ? (
              <p className="h-8 flex items-center text-sm truncate">{f.party?.name ?? '—'}</p>
            ) : (
              <PartyPicker kind={f.direction === 'RECEIVABLE' ? 'customer' : 'supplier'} value={f.party} onChange={(p) => set('party', p)} />
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cheque # *</Label>
            <Input className="h-8 text-sm" value={f.chequeNumber} disabled={disabled} onChange={(e) => set('chequeNumber', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Amount (Rs.) *</Label>
            <Input className="h-8 text-sm" inputMode="decimal" value={f.amount} disabled={disabled} onChange={(e) => set('amount', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cheque date *</Label>
            <Input type="date" className="h-8 text-sm" value={f.chequeDate} disabled={disabled} onChange={(e) => set('chequeDate', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{f.direction === 'RECEIVABLE' ? 'Received date' : 'Issued date'}</Label>
            <Input type="date" className="h-8 text-sm" value={f.receivedDate} disabled={disabled} onChange={(e) => set('receivedDate', e.target.value)} />
          </div>
          {banks.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Bank account (deposit / issuing)</Label>
              <Select items={bankItems} value={f.bankAccountId || 'none'} disabled={disabled}
                onValueChange={(v) => set('bankAccountId', !v || v === 'none' ? '' : String(v))}>
                <SelectTrigger className="w-full h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {bankItems.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Drawer bank</Label>
            <Input className="h-8 text-sm" placeholder="e.g. HBL, Meezan" value={f.drawerBank} disabled={disabled} onChange={(e) => set('drawerBank', e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Input className="h-8 text-sm" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 font-medium" role="alert">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add cheque'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
