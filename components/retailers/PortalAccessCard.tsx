'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils/format'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

interface PortalStatus {
  portalUsername: string | null
  portalEnabled: boolean
  hasPassword: boolean
  portalLastLoginAt: string | null
  lockedUntil: string | null
}

// Staff-only (ADMIN/MANAGER) — customers cannot change their own password; staff set and reset it here.
export function PortalAccessCard({ retailerId }: { retailerId: string }) {
  const { user } = useCurrentUser()
  const allowed = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [status, setStatus] = useState<PortalStatus | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/retailers/${retailerId}/portal`)
      if (!res.ok) return
      const j = await res.json()
      setStatus(j.data)
      setUsername(j.data.portalUsername ?? '')
    } catch {
      toast.error('Could not load portal access')
    }
  }, [retailerId])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  if (!allowed) return null

  const save = async (body: object, okMessage: string) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/retailers/${retailerId}/portal`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error ?? 'Could not save'); return }
      toast.success(okMessage)
      setPassword('')
      setStatus(j.data)
      setUsername(j.data.portalUsername ?? '')
    } catch {
      toast.error('Could not save — please try again')
    } finally {
      setSaving(false)
    }
  }

  const saveLogin = () => {
    const body: { username?: string; password?: string } = {}
    if (username.trim() && username.trim().toLowerCase() !== (status?.portalUsername ?? '')) body.username = username
    if (password) body.password = password
    if (!body.username && !body.password) { toast.error('Enter a new username and/or password'); return }
    save(body, body.password ? 'Login saved — the customer was signed out of any open session' : 'Username saved')
  }

  const stateBadge = !status ? null
    : status.lockedUntil ? <Badge className="bg-red-100 text-red-700">Locked</Badge>
    : status.portalEnabled ? <Badge className="bg-green-100 text-green-700">Enabled</Badge>
    : status.portalUsername ? <Badge className="bg-slate-100 text-slate-600">Disabled</Badge>
    : <Badge variant="outline">Not set up</Badge>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound size={16} className="text-blue-500" /> Portal access {stateBadge}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Username</label>
          <Input className="h-8" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. alipharmacy" autoComplete="off" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">{status?.hasPassword ? 'Reset password' : 'Password'} (min 8 characters)</label>
          <Input className="h-8" type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder={status?.hasPassword ? 'Leave blank to keep the current one' : ''} autoComplete="off" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={saveLogin} disabled={saving}>Save login</Button>
          {status?.portalUsername && status.hasPassword && (
            <Button size="sm" variant="outline" disabled={saving}
              onClick={() => save({ enabled: !status.portalEnabled }, status.portalEnabled ? 'Portal access disabled' : 'Portal access enabled')}>
              {status.portalEnabled ? 'Disable access' : 'Enable access'}
            </Button>
          )}
        </div>
        {status?.portalLastLoginAt && <p className="text-xs text-slate-400">Last login: {formatDate(status.portalLastLoginAt)}</p>}
        {status?.lockedUntil && <p className="text-xs text-red-600">Locked after repeated wrong passwords — resetting the password unlocks it.</p>}
        <p className="text-xs text-slate-400">Customers sign in at <span className="font-mono">/portal/login</span>. They cannot change their own password.</p>
      </CardContent>
    </Card>
  )
}
