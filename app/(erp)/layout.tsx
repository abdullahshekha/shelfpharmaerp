'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from '@/components/shared/Sidebar'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Image from 'next/image'

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [role, setRole] = useState('ADMIN')
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(j => { if (j.data?.role) setRole(j.data.role) })

    const fetchNotifs = () => {
      fetch('/api/notifications')
        .then(r => r.json())
        .then(j => setUnreadCount(j.unreadCount ?? 0))
    }
    fetchNotifs()
    const interval = setInterval(fetchNotifs, 60_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-shrink-0 sticky top-0 h-screen">
        <Sidebar role={role} unreadCount={unreadCount} />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-50 flex-shrink-0">
            <Sidebar onClose={() => setSidebarOpen(false)} role={role} unreadCount={unreadCount} />
          </aside>
        </div>
      )}

      <div className="flex flex-col flex-1">
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </Button>
          <Image src="/logo.png" alt="Shelf Pharma" width={100} height={36} className="object-contain" />
        </header>

        <main className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
