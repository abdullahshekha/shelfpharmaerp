'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Plus, Trash2 } from 'lucide-react'
import { AccountSelect } from './AccountSelect'
import { PartyPicker, type Party } from './PartyPicker'
import { formatPKR } from '@/lib/utils/format'
import { todayKarachi, type Account } from './types'

interface Line { accountId: string; debit: string; credit: string; memo: string; party: Party | null }
const blank = (): Line => ({ accountId: '', debit: '', credit: '', memo: '', party: null })
const paisa = (s: string) => Math.round((parseFloat(s) || 0) * 100)

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  accounts: Account[]
  onPosted: () => void
}

export function ManualJournalDialog({ open, onOpenChange, accounts, onPosted }: Props) {
  const [date, setDate] = useState(todayKarachi())
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState<Line[]>([blank(), blank()])
  const [saving, setSaving] = useState(false)

  const accById = new Map(accounts.map(a => [a.id, a]))
  const keyOf = (l: Line) => accById.get(l.accountId)?.systemKey ?? null
  const totalD = lines.reduce((s, l) => s + paisa(l.debit), 0)
  const totalC = lines.reduce((s, l) => s + paisa(l.credit), 0)
  const balanced = totalD > 0 && totalD === totalC

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  // Fresh form every time the dialog opens (also covers Cancel / X / overlay close).
  useEffect(() => { if (open) reset() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setDate(todayKarachi()); setMemo(''); setLines([blank(), blank()]) }

  const submit = async () => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!l.accountId) return toast.error(`Line ${i + 1}: choose an account`)
      if (paisa(l.debit) < 0 || paisa(l.credit) < 0) return toast.error(`Line ${i + 1}: amounts cannot be negative`)
      if (paisa(l.debit) > 0 && paisa(l.credit) > 0) return toast.error(`Line ${i + 1}: use either debit or credit, not both`)
      if (paisa(l.debit) === 0 && paisa(l.credit) === 0) return toast.error(`Line ${i + 1}: enter an amount`)
      if (keyOf(l) === 'AR' && !l.party) return toast.error(`Line ${i + 1}: Accounts Receivable needs a customer`)
      if (keyOf(l) === 'AP' && !l.party) return toast.error(`Line ${i + 1}: Accounts Payable needs a supplier`)
    }
    if (!balanced) return toast.error('Debits and credits must balance')
    setSaving(true)
    try {
      const res = await fetch('/api/accounts/journals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          memo,
          lines: lines.map(l => ({
            accountId: l.accountId,
            debit: paisa(l.debit) / 100,
            credit: paisa(l.credit) / 100,
            memo: l.memo || undefined,
            retailerId: keyOf(l) === 'AR' ? l.party?.id : undefined,
            supplierId: keyOf(l) === 'AP' ? l.party?.id : undefined,
          })),
        }),
      })
      const j = await res.json()
      if (!res.ok) return toast.error(j.error ?? 'Could not post entry')
      toast.success(`Posted ${j.data?.entryNumber ?? 'entry'}`)
      onOpenChange(false)
      onPosted()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manual journal entry</DialogTitle>
          <DialogDescription>Debits must equal credits. Receivable lines need a customer, payable lines a supplier.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-3">
          <div>
            <p className="text-xs text-slate-500 mb-1">Date</p>
            <Input type="date" className="h-8 w-40 text-sm" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <p className="text-xs text-slate-500 mb-1">Memo</p>
            <Input className="h-8 text-sm" value={memo} onChange={e => setMemo(e.target.value)} placeholder="Description" />
          </div>
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => {
            const needsParty = keyOf(l) === 'AR' || keyOf(l) === 'AP'
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 border rounded-md p-2">
                <AccountSelect accounts={accounts.filter(a => a.isActive)} value={l.accountId}
                  onChange={id => setLine(i, { accountId: id, party: null })} className="w-60 h-8 text-sm" />
                {needsParty && (
                  <PartyPicker kind={keyOf(l) === 'AR' ? 'customer' : 'supplier'} value={l.party} onChange={p => setLine(i, { party: p })} />
                )}
                <Input type="number" min={0} step="0.01" placeholder="Debit" className="h-8 w-28 text-sm text-right"
                  value={l.debit} onChange={e => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                <Input type="number" min={0} step="0.01" placeholder="Credit" className="h-8 w-28 text-sm text-right"
                  value={l.credit} onChange={e => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                <Input placeholder="Line memo" className="h-8 flex-1 min-w-[8rem] text-sm"
                  value={l.memo} onChange={e => setLine(i, { memo: e.target.value })} />
                <Button type="button" variant="ghost" size="icon-sm" disabled={lines.length <= 2}
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}>
                  <Trash2 size={14} />
                </Button>
              </div>
            )
          })}
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setLines(prev => [...prev, blank()])}>
            <Plus size={14} /> Add line
          </Button>
        </div>

        <div className="flex justify-end gap-6 text-sm">
          <span>Debit <b>{formatPKR(totalD / 100)}</b></span>
          <span>Credit <b>{formatPKR(totalC / 100)}</b></span>
          <span className={balanced ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
            {balanced ? 'Balanced' : `Out by ${formatPKR(Math.abs(totalD - totalC) / 100)}`}
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !balanced}>{saving ? 'Posting…' : 'Post entry'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
