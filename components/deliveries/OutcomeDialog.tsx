'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPKR } from '@/lib/utils/format'
import {
  HOLD_REASONS, RETURN_REASONS, amountDueFromStored, returnCreditPaisa, type Outcome,
} from '@/lib/deliveries/outcome-rules'
import { Camera, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { OUTCOME_LABEL, type BoardDelivery } from './types'

interface Bank { id: string; code: string; name: string }

const OUTCOME_ORDER: Outcome[] = ['PAID_FULL', 'PAID_WITH_RETURN', 'PAY_LATER', 'RETURNED', 'ON_HOLD']
const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank' },
  { value: 'CHEQUE', label: 'Cheque' },
]
const karachiDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const tomorrow = () => karachiDay(new Date(Date.now() + 86400000))

interface Props {
  delivery: BoardDelivery | null
  onClose: () => void
  onDone: () => void
}

function Pick({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string
}) {
  return (
    <Select items={options} value={value} onValueChange={v => onChange(v ?? '')}>
      <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/** Record what happened at the door. The server recomputes the amount to collect; this one is a read-only preview. */
export function OutcomeDialog({ delivery, onClose, onDone }: Props) {
  const [outcome, setOutcome] = useState<Outcome | ''>('')
  const [method, setMethod] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [pictureUrl, setPictureUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [chequeNumber, setChequeNumber] = useState('')
  const [chequeDate, setChequeDate] = useState(karachiDay(new Date()))
  const [drawerBank, setDrawerBank] = useState('')
  const [chequeAmount, setChequeAmount] = useState<string | null>(null)
  const [retQty, setRetQty] = useState<Record<string, string>>({})
  const [retReason, setRetReason] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [holdUntil, setHoldUntil] = useState(tomorrow())
  const [banks, setBanks] = useState<Bank[]>([])
  const [busy, setBusy] = useState(false)

  const open = !!delivery
  useEffect(() => {
    if (!delivery) return
    setOutcome(''); setMethod(''); setBankAccountId(''); setPictureUrl(''); setChequeNumber('')
    setChequeDate(karachiDay(new Date())); setDrawerBank(''); setChequeAmount(null)
    setRetQty({}); setRetReason({}); setReason(''); setHoldUntil(tomorrow())
  }, [delivery])
  useEffect(() => {
    if (!open) return
    fetch('/api/cheques/banks').then(r => r.json()).then(j => setBanks(j.data ?? [])).catch(() => setBanks([]))
  }, [open])

  const order = delivery?.order
  const pays = outcome === 'PAID_FULL' || outcome === 'PAID_WITH_RETURN'

  const returnedLines = useMemo(() => {
    if (!order) return []
    return order.items
      .map(i => ({ orderItemId: i.id, quantity: Number(retQty[i.id] ?? 0), reason: retReason[i.id] || undefined }))
      .filter(l => l.quantity > 0)
  }, [order, retQty, retReason])

  // Same arithmetic as the server: stored invoice total - payments already recorded - return credit.
  const duePaisa = useMemo(() => {
    if (!order) return 0
    const invoiceTotal = Number(order.invoice?.totalAmount ?? order.totalAmount)
    const paid = (order.invoice?.payments ?? []).reduce((s, p) => s + Number(p.amount), 0)
    let credit = 0
    if (outcome === 'PAID_WITH_RETURN') {
      for (const l of returnedLines) {
        const it = order.items.find(i => i.id === l.orderItemId)
        if (it && Number.isInteger(l.quantity) && l.quantity <= it.quantity) {
          credit += returnCreditPaisa({ id: it.id, quantity: it.quantity, lineTotal: Number(it.lineTotal), salesTaxAmount: Number(it.salesTaxAmount) }, l.quantity)
        }
      }
    }
    return amountDueFromStored({ invoiceTotal, paid, creditPaisa: credit })
  }, [order, outcome, returnedLines])
  const due = duePaisa / 100

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/deliveries/upload-picture', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.url) setPictureUrl(j.url)
      else toast.error(j.error ?? 'Picture upload failed')
    } catch {
      toast.error('Picture upload failed')
    } finally {
      setUploading(false)
    }
  }

  const problem = (): string | null => {
    if (!outcome) return 'Choose an outcome'
    if (outcome === 'RETURNED' && !reason) return 'Choose a return reason'
    if (outcome === 'ON_HOLD' && (!reason || !holdUntil)) return 'Choose a hold reason and date'
    if (outcome === 'PAID_WITH_RETURN') {
      if (returnedLines.length === 0) return 'Enter the returned quantity for at least one line'
      for (const l of returnedLines) {
        const it = order!.items.find(i => i.id === l.orderItemId)!
        if (!Number.isInteger(l.quantity) || l.quantity > it.quantity) return `Returned quantity for ${it.medicine.name} cannot exceed ${it.quantity}`
      }
    }
    if (pays) {
      if (!method) return 'Choose a payment method'
      if (method === 'BANK' && !bankAccountId) return 'Choose the bank account'
      if (method === 'CHEQUE' && (!chequeNumber.trim() || !chequeDate)) return 'Enter the cheque number and date'
      if (!pictureUrl) return 'Take a picture as proof'
    }
    return null
  }

  const submit = async (allowDuplicate = false) => {
    if (!delivery) return
    const p = problem()
    if (p) { toast.error(p); return }
    const body: Record<string, unknown> = { outcome }
    if (pays) {
      body.method = method
      body.pictureUrl = pictureUrl
      if (method === 'BANK') body.bankAccountId = bankAccountId
      if (method === 'CHEQUE') {
        body.chequeNumber = chequeNumber.trim()
        body.chequeDate = chequeDate
        body.chequeAmount = chequeAmount ?? due.toFixed(2)
        if (drawerBank.trim()) body.drawerBank = drawerBank.trim()
        if (bankAccountId) body.bankAccountId = bankAccountId
        if (allowDuplicate) body.allowDuplicate = true
      }
    }
    if (outcome === 'PAID_WITH_RETURN') body.returnedLines = returnedLines
    if (outcome === 'RETURNED') body.reason = reason
    if (outcome === 'ON_HOLD') { body.reason = reason; body.holdUntil = holdUntil }
    setBusy(true)
    try {
      const res = await fetch(`/api/deliveries/${delivery.id}/outcome`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`Recorded: ${OUTCOME_LABEL[outcome as string]}`)
        onDone()
        return
      }
      if (res.status === 409 && j.duplicate && !allowDuplicate) {
        if (window.confirm(`${j.error}\n\nRecord anyway?`)) { setBusy(false); return submit(true) }
        return
      }
      toast.error(j.error ?? 'Could not record the outcome')
    } catch {
      toast.error('Could not record the outcome')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record outcome</DialogTitle>
          <DialogDescription>
            {order ? `${order.retailer.name} · ${order.orderNumber}` : ''}
          </DialogDescription>
        </DialogHeader>

        {order && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>What happened</Label>
              <Pick value={outcome} onChange={v => setOutcome(v as Outcome)} placeholder="Choose an outcome"
                options={OUTCOME_ORDER.map(o => ({ value: o, label: OUTCOME_LABEL[o] }))} />
            </div>

            {outcome === 'PAID_WITH_RETURN' && (
              <div className="space-y-2">
                <Label>Returned items</Label>
                <div className="rounded-md border divide-y">
                  {order.items.map(i => (
                    <div key={i.id} className="p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{i.medicine.name}</span>
                        <span className="text-xs text-slate-500 whitespace-nowrap">ordered {i.quantity}</span>
                      </div>
                      <div className="flex gap-2">
                        <Input type="number" inputMode="numeric" min={0} max={i.quantity} placeholder="Returned qty" className="h-8 w-28 text-sm"
                          value={retQty[i.id] ?? ''} onChange={e => setRetQty(m => ({ ...m, [i.id]: e.target.value }))} />
                        <div className="flex-1">
                          <Pick value={retReason[i.id] ?? ''} onChange={v => setRetReason(m => ({ ...m, [i.id]: v }))} placeholder="Reason (optional)"
                            options={RETURN_REASONS.map(r => ({ value: r, label: r }))} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pays && (
              <>
                <div className="rounded-md bg-slate-50 border p-3 flex items-center justify-between">
                  <span className="text-sm text-slate-600">Amount to collect</span>
                  <span className="text-lg font-semibold">{formatPKR(due)}</span>
                </div>

                <div className="space-y-1.5">
                  <Label>Paid by</Label>
                  <Pick value={method} onChange={setMethod} options={METHODS} placeholder="Cash, Bank or Cheque" />
                </div>

                {method === 'BANK' && (
                  <div className="space-y-1.5">
                    <Label>Bank account</Label>
                    <Pick value={bankAccountId} onChange={setBankAccountId} placeholder="Choose the bank account"
                      options={banks.map(b => ({ value: b.id, label: `${b.code} ${b.name}` }))} />
                  </div>
                )}

                {method === 'CHEQUE' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Cheque number</Label>
                      <Input value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cheque date</Label>
                      <Input type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cheque amount</Label>
                      <Input type="number" inputMode="decimal" step="0.01" value={chequeAmount ?? due.toFixed(2)} onChange={e => setChequeAmount(e.target.value)} />
                      <p className="text-[11px] text-slate-400">Must equal the amount to collect.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Drawer bank (optional)</Label>
                      <Input value={drawerBank} onChange={e => setDrawerBank(e.target.value)} />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Proof picture</Label>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex">
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} />
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-sm cursor-pointer hover:border-slate-400">
                        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                        {uploading ? 'Uploading...' : pictureUrl ? 'Retake' : 'Take Photo'}
                      </span>
                    </label>
                    {pictureUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pictureUrl} alt="Proof" className="h-12 w-12 rounded object-cover border" />
                    )}
                  </div>
                </div>
              </>
            )}

            {outcome === 'PAY_LATER' && (
              <p className="text-sm text-slate-600">
                The order is marked delivered and the full amount ({formatPKR(due)}) stays receivable on the invoice.
              </p>
            )}

            {outcome === 'RETURNED' && (
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Pick value={reason} onChange={setReason} placeholder="Why was it returned?"
                  options={RETURN_REASONS.map(r => ({ value: r, label: r }))} />
                <p className="text-[11px] text-slate-400">The whole order comes back. This is final.</p>
              </div>
            )}

            {outcome === 'ON_HOLD' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Pick value={reason} onChange={setReason} placeholder="Why on hold?"
                    options={HOLD_REASONS.map(r => ({ value: r, label: r }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Deliver again on</Label>
                  <Input type="date" min={karachiDay(new Date())} value={holdUntil} onChange={e => setHoldUntil(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => submit()} disabled={busy || uploading || !outcome}>{busy ? 'Saving...' : 'Save outcome'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
