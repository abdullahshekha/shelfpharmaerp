'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { X, LogOut, Bell, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { roleLabel } from '@/lib/constants'
import { visibleHubs, isHubActive } from '@/lib/nav'

interface SidebarProps {
  onClose?: () => void
  role?: string
  unreadCount?: number
  /** Icon-only rail (desktop). The mobile overlay is always expanded. */
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function Sidebar({ onClose, role = 'ADMIN', unreadCount = 0, collapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const hubs = visibleHubs(role)

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className={cn('flex flex-col h-full bg-slate-900 text-white transition-[width] duration-200', collapsed ? 'w-16' : 'w-64')}>
      <div className={cn('flex items-center border-b border-slate-700 px-4 py-3', collapsed ? 'justify-center' : 'justify-between')}>
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <Image src="/logo.png" alt="Shelf Pharma" width={120} height={48} className="object-contain" priority />
          </div>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:block text-slate-400 hover:text-white flex-shrink-0"
          >
            {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white flex-shrink-0">
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
        {hubs.map((hub) => {
          const Icon = hub.icon
          // Pending delete-approvals live under Settings > Approvals, so the badge sits on Settings
          const badge = hub.key === 'settings' ? unreadCount : 0
          return (
            <Link
              key={hub.key}
              href={hub.target}
              onClick={onClose}
              title={collapsed ? hub.label : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                collapsed && 'justify-center',
                isHubActive(hub, pathname)
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
            >
              <div className="relative flex-shrink-0">
                <Icon size={18} />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </div>
              {!collapsed && <span>{hub.label}</span>}
              {!collapsed && badge > 0 && (
                <span className="ml-auto bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{badge}</span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t border-slate-700 space-y-2">
        {!collapsed && (
          <>
            <div className="px-1 flex items-center gap-2">
              <Bell size={13} className="text-slate-500" />
              <p className="text-xs text-slate-500 capitalize">{roleLabel(role).toLowerCase()}</p>
            </div>
            <p className="text-xs text-slate-500 px-1">PECHS Ext. Block 6, Karachi</p>
          </>
        )}
        <button
          onClick={handleSignOut}
          title={collapsed ? 'Sign Out' : undefined}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors',
            collapsed && 'justify-center'
          )}
        >
          <LogOut size={16} />
          {!collapsed && 'Sign Out'}
        </button>
      </div>
    </div>
  )
}
