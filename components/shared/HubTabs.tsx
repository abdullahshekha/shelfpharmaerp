'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { tabBarFor } from '@/lib/nav'

/** Tab bar for a nav hub (Sales, Purchase, ...). Renders only on the hub's list pages. */
export function HubTabs({ role, badges = {} }: { role: string; badges?: Record<string, number> }) {
  const pathname = usePathname()
  const bar = tabBarFor(pathname, role)
  if (!bar) return null
  const current = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname

  return (
    <div className="mb-4 -mx-4 lg:mx-0 px-4 lg:px-0 border-b border-slate-200 overflow-x-auto">
      <nav className="flex gap-1 min-w-max" aria-label={`${bar.hub.label} sections`}>
        {bar.tabs.map((tab) => {
          const count = badges[tab.href] ?? 0
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors flex items-center gap-1.5',
                tab.href === current
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              {tab.label}
              {count > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{count}</span>
              )}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
