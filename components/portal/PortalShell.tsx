'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut } from 'lucide-react'

export function PortalShell({ customerName, children }: { customerName: string; children: React.ReactNode }) {
  const pathname = usePathname()

  const logout = async () => {
    await fetch('/api/portal/logout', { method: 'POST' })
    window.location.href = '/portal/login'
  }

  const tab = (href: string, label: string) => {
    const active = href === '/portal' ? pathname === '/portal' : pathname.startsWith(href)
    return (
      <Link href={href}
        className={`px-4 py-2 text-sm font-medium border-b-2 ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
        {label}
      </Link>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 pt-3 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs text-slate-400">Shelf Pharma</p>
            <p className="font-semibold text-slate-900 truncate">{customerName}</p>
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <LogOut size={15} /> Sign out
          </button>
        </div>
        <nav className="max-w-3xl mx-auto px-2 flex">
          {tab('/portal', 'Order')}
          {tab('/portal/orders', 'My Orders')}
        </nav>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-4">{children}</main>
    </div>
  )
}
