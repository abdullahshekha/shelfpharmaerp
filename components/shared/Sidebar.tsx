'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Package, Users, ShoppingCart, MessageSquare,
  FileText, Truck, UserCog, BarChart3, ListOrdered, X, LogOut,
  Building2, Bell, CheckSquare, Settings,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavItem { href: string; label: string; icon: React.ElementType; roles?: string[] }

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',   label: 'Dashboard',       icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD'] },
  { href: '/inventory',   label: 'Inventory',        icon: Package,         roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'WAREHOUSE'] },
  { href: '/retailers',   label: 'Retailers',        icon: Users,           roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'SALES_REP'] },
  { href: '/orders',      label: 'Orders',           icon: ShoppingCart,    roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'SALES_REP'] },
  { href: '/whatsapp',    label: 'WhatsApp Orders',  icon: MessageSquare,   roles: ['ADMIN', 'MANAGER'] },
  { href: '/offer-list',  label: 'Offer List',       icon: ListOrdered,     roles: ['ADMIN', 'MANAGER'] },
  { href: '/invoices',    label: 'Invoices',         icon: FileText,        roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'ACCOUNTANT'] },
  { href: '/deliveries',  label: 'Deliveries',       icon: Truck,           roles: ['ADMIN', 'MANAGER'] },
  { href: '/suppliers',   label: 'Suppliers',        icon: Building2,       roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { href: '/hr',          label: 'HR',               icon: UserCog,         roles: ['ADMIN', 'MANAGER'] },
  { href: '/reports',     label: 'Reports',          icon: BarChart3,       roles: ['ADMIN', 'MANAGER'] },
  { href: '/settings',    label: 'Settings',         icon: Settings,        roles: ['ADMIN', 'MANAGER'] },
]

interface SidebarProps {
  onClose?: () => void
  role?: string
  unreadCount?: number
}

export function Sidebar({ onClose, role = 'ADMIN', unreadCount = 0 }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const visibleItems = NAV_ITEMS.filter(item =>
    !item.roles || item.roles.includes(role)
  )

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const showApprovals = role === 'ADMIN' || role === 'MANAGER'

  return (
    <div className="flex flex-col h-full bg-slate-900 text-white w-64">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2 min-w-0">
          <Image src="/logo.png" alt="Shelf Pharma" width={120} height={48} className="object-contain" priority />
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white flex-shrink-0">
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onClose}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}

        {showApprovals && (
          <Link
            href="/approvals"
            onClick={onClose}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname.startsWith('/approvals')
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            )}
          >
            <div className="relative">
              <CheckSquare size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            <span>Approvals</span>
            {unreadCount > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </Link>
        )}
      </nav>

      <div className="p-3 border-t border-slate-700 space-y-2">
        <div className="px-1 flex items-center gap-2">
          <Bell size={13} className="text-slate-500" />
          <p className="text-xs text-slate-500 capitalize">{role.toLowerCase().replace('_', ' ')}</p>
        </div>
        <p className="text-xs text-slate-500 px-1">PECHS Ext. Block 6, Karachi</p>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  )
}
