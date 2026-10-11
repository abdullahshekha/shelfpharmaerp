'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff, Lock } from 'lucide-react'

export default function PortalLoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/portal/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
      })
      if (res.ok) {
        router.push('/portal')
        router.refresh()
        return
      }
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? 'Login failed')
    } catch {
      setError('Could not reach the server — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Image src="/logo.png" alt="Shelf Pharma" width={180} height={72} className="object-contain" priority />
        </div>
        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-slate-900">Customer Portal</h1>
            <p className="text-sm text-slate-500 mt-1">Sign in to place your order</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" autoComplete="username" autoCapitalize="none" value={username}
                onChange={e => setUsername(e.target.value)} disabled={loading} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
                  onChange={e => setPassword(e.target.value)} disabled={loading} className="pr-10" />
                <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}
            <Button type="submit" className="w-full gap-2" disabled={loading || !username || !password}>
              <Lock size={14} /> {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="text-xs text-center text-slate-400">Forgot your password? Contact Shelf Pharma — 0330-7774353</p>
        </div>
      </div>
    </div>
  )
}
