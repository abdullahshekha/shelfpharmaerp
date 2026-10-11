'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Lock } from 'lucide-react'
import { AccountingSettingsCard } from './AccountingSettingsCard'
import { ACCOUNT_TYPES, TYPE_LABELS, type Account } from './types'

interface Form { id: string | null; code: string; name: string; type: Account['type']; subType: string; isActive: boolean; isSystem: boolean }

export function ChartOfAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/accounts/accounts?includeInactive=1')
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error ?? 'Could not load accounts'); setLoadError(j.error ?? `HTTP ${res.status}`); return }
      setLoadError('')
      setAccounts(j.data ?? [])
    } catch {
      toast.error('Network error loading accounts')
      setLoadError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const openNew = () => setForm({ id: null, code: '', name: '', type: 'EXPENSE', subType: '', isActive: true, isSystem: false })
  const openEdit = (a: Account) => setForm({ id: a.id, code: a.code, name: a.name, type: a.type, subType: a.subType ?? '', isActive: a.isActive, isSystem: a.isSystem })

  const save = async () => {
    if (!form) return
    if (!form.code.trim() || !form.name.trim()) return toast.error('Code and name are required')
    setSaving(true)
    try {
      const body = form.id
        ? { name: form.name, isActive: form.isActive, ...(form.isSystem ? {} : { code: form.code, type: form.type, subType: form.subType }) }
        : { code: form.code, name: form.name, type: form.type, subType: form.subType || undefined }
      const res = await fetch(form.id ? `/api/accounts/accounts/${form.id}` : '/api/accounts/accounts', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(j.error ?? 'Could not save account')
      toast.success(form.id ? 'Account updated' : 'Account added')
      setForm(null)
      load()
    } catch {
      toast.error('Network error while saving')
    } finally {
      setSaving(false)
    }
  }

  const visible = accounts.filter(a => showInactive || a.isActive)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Chart of Accounts</h1>
          <p className="text-slate-500 text-sm">{accounts.filter(a => a.isActive).length} active accounts</p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
          </label>
          <Button size="sm" className="gap-2" onClick={openNew}><Plus size={14} /> Add account</Button>
        </div>
      </div>

      {loadError && <p className="text-sm text-red-600">Could not load accounts: {loadError}</p>}
      <AccountingSettingsCard accounts={accounts} />

      {ACCOUNT_TYPES.map(type => {
        const rows = visible.filter(a => a.type === type)
        return (
          <Card key={type}>
            <CardContent className="p-0">
              <div className="px-4 py-2 border-b bg-slate-50 text-sm font-semibold text-slate-700">{TYPE_LABELS[type]}</div>
              <table className="w-full text-sm">
                <tbody>
                  {loading ? (
                    <tr className="animate-pulse"><td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded" /></td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td className="px-4 py-3 text-slate-400">No accounts</td></tr>
                  ) : rows.map(a => (
                    <tr key={a.id} className={`border-b last:border-0 ${a.isActive ? '' : 'opacity-50'}`}>
                      <td className="px-4 py-2 w-24 font-mono text-slate-500">{a.code}</td>
                      <td className="px-2 py-2">
                        {a.name}
                        {a.subType && <span className="ml-2 text-xs text-slate-400">{a.subType}</span>}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {a.isSystem && <Badge variant="secondary" className="gap-1"><Lock size={10} /> System</Badge>}
                        {!a.isActive && <Badge variant="outline" className="ml-1">Inactive</Badge>}
                      </td>
                      <td className="px-4 py-2 w-12 text-right">
                        <Button variant="ghost" size="icon-sm" onClick={() => openEdit(a)} aria-label={`Edit ${a.name}`}><Pencil size={14} /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )
      })}

      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?.id ? 'Edit account' : 'Add account'}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              {form.isSystem && <p className="text-xs text-slate-500">System account: code and type are locked and it cannot be deactivated.</p>}
              <div>
                <p className="text-xs text-slate-500 mb-1">Code</p>
                <Input className="h-8 text-sm" value={form.code} disabled={form.isSystem} onChange={e => setForm({ ...form, code: e.target.value })} />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Name</p>
                <Input className="h-8 text-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Type</p>
                <Select
                  items={ACCOUNT_TYPES.map(t => ({ value: t, label: TYPE_LABELS[t] }))}
                  value={form.type}
                  disabled={form.isSystem}
                  onValueChange={v => v && setForm({ ...form, type: v as Account['type'] })}
                >
                  <SelectTrigger className="h-8 text-sm w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Sub-type (optional, e.g. BANK or CASH for payment accounts)</p>
                <Input className="h-8 text-sm" value={form.subType} disabled={form.isSystem} onChange={e => setForm({ ...form, subType: e.target.value })} />
              </div>
              {form.id && !form.isSystem && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> Active
                </label>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
