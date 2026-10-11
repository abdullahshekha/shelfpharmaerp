'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RefreshCw } from 'lucide-react'
import { AccountSelect } from './AccountSelect'
import { toDateInput, type Account, type AccountingSettings } from './types'

interface RebuildTotals { total: number; posted: number; removed: number; unchanged: number; orphansRemoved: number }
interface RebuildResult {
  totals: RebuildTotals
  skipped: { type: string; id: string; reason: string }[]
  errors: { type: string; id: string; error: string }[]
}

export function AccountingSettingsCard({ accounts }: { accounts: Account[] }) {
  const [settings, setSettings] = useState<AccountingSettings | null>(null)
  const [goLive, setGoLive] = useState('')
  const [locked, setLocked] = useState('')
  const [bank, setBank] = useState('')
  const [saving, setSaving] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<RebuildResult | null>(null)

  const [loadError, setLoadError] = useState('')
  const rebuildingRef = useRef(false)

  useEffect(() => {
    fetch('/api/accounts/settings')
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
        return j
      })
      .then(j => {
        const s: AccountingSettings | undefined = j.data
        if (!s) return
        setSettings(s)
        setGoLive(toDateInput(s.goLiveDate))
        setLocked(toDateInput(s.lockedThrough))
        setBank(s.defaultBankAccountId ?? '')
      })
      .catch(e => { setLoadError(e.message || 'Could not load settings'); toast.error('Could not load accounts settings') })
  }, [])

  const dirty = !!settings && (
    goLive !== toDateInput(settings.goLiveDate) ||
    locked !== toDateInput(settings.lockedThrough) ||
    bank !== (settings.defaultBankAccountId ?? '')
  )

  const bankAccounts = accounts.filter(a => a.isActive && a.type === 'ASSET' && (a.subType === 'BANK' || a.subType === 'CASH'))

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/accounts/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goLiveDate: goLive || null, lockedThrough: locked || null, defaultBankAccountId: bank || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not save settings')
      setSettings(j.data)
      toast.success('Accounts settings saved')
      if (j.warning) toast.warning(j.warning, { duration: 10000 })
    } catch {
      toast.error('Network error while saving settings')
    } finally {
      setSaving(false)
    }
  }

  const rebuild = async () => {
    if (rebuildingRef.current) return
    if (!settings?.goLiveDate) return toast.error('Save a go-live date first')
    if (dirty) return toast.error('Save your settings changes before rebuilding')
    if (!confirm('Re-sync the ledger for every record dated since go-live? This is safe to repeat.')) return
    rebuildingRef.current = true
    setRebuilding(true)
    setResult(null)
    const totals: RebuildTotals = { total: 0, posted: 0, removed: 0, unchanged: 0, orphansRemoved: 0 }
    const skipped: RebuildResult['skipped'] = []
    const errors: RebuildResult['errors'] = []
    let body: Record<string, unknown> = {}
    let calls = 0
    try {
      for (;;) {
        calls++
        setProgress(`Working… step ${calls}${body.type ? ` (${String(body.type).replace(/_/g, ' ').toLowerCase()})` : ''}, ${totals.total} records processed`)
        const res = await fetch('/api/accounts/rebuild', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(j.error ?? `Rebuild stopped (HTTP ${res.status}). Partial progress is saved; run it again to continue.`)
          break
        }
        const r = j.data
        totals.total += r.total ?? 0
        totals.posted += r.posted ?? 0
        totals.removed += r.removed ?? 0
        totals.unchanged += r.unchanged ?? 0
        totals.orphansRemoved += r.orphansRemoved ?? 0
        skipped.push(...(r.skipped ?? []))
        errors.push(...(r.errors ?? []))
        if (r.done || !r.next) {
          setResult({ totals, skipped, errors })
          if (errors.length) toast.warning(`Rebuild finished with ${errors.length} error(s)`)
          else toast.success('Ledger rebuild complete')
          break
        }
        body = { type: r.next.type, after: r.next.after }
        if (calls > 5000) { toast.error('Rebuild aborted: too many steps'); break }
      }
    } catch {
      toast.error('Network error during rebuild. Partial progress is saved; run it again to continue.')
    } finally {
      rebuildingRef.current = false
      setRebuilding(false)
      setProgress('')
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <h2 className="font-semibold">Accounts settings</h2>
          <p className="text-xs text-slate-500">
            Only records dated on or after the go-live date are posted to the ledger. Nothing can be posted on or before the locked-through date.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <p className="text-xs text-slate-500 mb-1">Go-live date</p>
            <Input type="date" className="h-8 w-40 text-sm" value={goLive} onChange={e => setGoLive(e.target.value)} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Locked through</p>
            <Input type="date" className="h-8 w-40 text-sm" value={locked} onChange={e => setLocked(e.target.value)} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Default bank / cash account</p>
            <div className="flex gap-1">
              <AccountSelect accounts={bankAccounts} value={bank} onChange={setBank} placeholder="None" className="w-56 h-8 text-sm" />
              {bank && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setBank('')}>Clear</Button>}
            </div>
          </div>
          <Button size="sm" onClick={save} disabled={saving || !settings}>{saving ? 'Saving…' : 'Save settings'}</Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={rebuild} disabled={rebuilding || !settings || dirty} title={dirty ? 'Save settings first' : undefined}>
            <RefreshCw size={14} className={rebuilding ? 'animate-spin' : ''} /> {rebuilding ? 'Rebuilding…' : 'Rebuild ledger'}
          </Button>
        </div>

        {loadError && <p className="text-sm text-red-600">Could not load settings: {loadError}</p>}
        {dirty && <p className="text-xs text-amber-600">Unsaved changes. Save settings before rebuilding the ledger.</p>}
        {rebuilding && progress && <p className="text-sm text-slate-600">{progress}</p>}

        {result && (
          <div className="rounded-md border bg-slate-50 p-3 text-sm space-y-2">
            <p>
              Processed <b>{result.totals.total}</b> · posted <b>{result.totals.posted}</b> · removed <b>{result.totals.removed}</b> ·
              unchanged <b>{result.totals.unchanged}</b> · orphan entries removed <b>{result.totals.orphansRemoved}</b>
            </p>
            {result.errors.length > 0 && (
              <div>
                <p className="font-medium text-red-600">{result.errors.length} error(s)</p>
                <ul className="text-xs max-h-40 overflow-auto list-disc pl-5">
                  {result.errors.map((e, i) => <li key={i}>{e.type} {e.id}: {e.error}</li>)}
                </ul>
              </div>
            )}
            {result.skipped.length > 0 && (
              <div>
                <p className="font-medium text-amber-600">{result.skipped.length} skipped</p>
                <ul className="text-xs max-h-40 overflow-auto list-disc pl-5">
                  {result.skipped.map((e, i) => <li key={i}>{e.type} {e.id}: {e.reason}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
