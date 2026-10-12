import {
  LayoutDashboard, Package, ShoppingCart, Truck, Wallet, BarChart3, Settings,
} from 'lucide-react'

// Single source of truth for the sidebar and the per-hub tab bars. Tabs point at the real page URLs
// (which are unchanged from before the restructure), so no existing link or bookmark breaks.
// Pages that aren't built yet still get a route (a "Coming soon" page) so the full structure is visible.

export interface NavTab { href: string; label: string; roles?: string[] }

export interface NavHub {
  key: string
  label: string
  icon: React.ElementType
  roles?: string[]
  /** Plain sidebar link (Dashboard, Inventory). Mutually exclusive with `tabs`. */
  href?: string
  tabs?: NavTab[]
}

const ADMIN_MANAGER = ['ADMIN', 'MANAGER']
const PURCHASING = ['ADMIN', 'MANAGER', 'ACCOUNTANT']
const ACCOUNTS = ['ADMIN', 'ACCOUNTANT']

export const NAV_HUBS: NavHub[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard', roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD'] },
  { key: 'inventory', label: 'Inventory', icon: Package, href: '/inventory', roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'WAREHOUSE'] },
  {
    key: 'sales', label: 'Sales', icon: ShoppingCart,
    tabs: [
      { href: '/orders',            label: 'Orders',        roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD'] },
      { href: '/invoices',          label: 'Invoices',      roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'ACCOUNTANT'] },
      { href: '/offer-list',        label: 'Offer List',    roles: ADMIN_MANAGER },
      { href: '/deliveries',        label: 'Deliveries',    roles: ['ADMIN', 'MANAGER', 'SALESMAN'] },
      { href: '/sales/returns',     label: 'Sales Returns', roles: ADMIN_MANAGER },
      { href: '/retailers',         label: 'Customers',     roles: ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'SALES_REP'] },
    ],
  },
  {
    key: 'purchase', label: 'Purchase', icon: Truck,
    tabs: [
      { href: '/suppliers',          label: 'Suppliers',        roles: PURCHASING },
      { href: '/purchase-invoices',  label: 'Purchase Invoice', roles: PURCHASING },
      { href: '/purchase/returns',   label: 'Purchase Returns', roles: PURCHASING },
      { href: '/purchase/demand',    label: 'Purchase Demand',  roles: PURCHASING },
    ],
  },
  {
    key: 'accounts', label: 'Accounts', icon: Wallet, roles: ACCOUNTS,
    tabs: [
      { href: '/accounts/general-ledger',       label: 'General Ledgers' },
      { href: '/accounts/receivable',           label: 'Accounts Receivable' },
      { href: '/accounts/payable',              label: 'Accounts Payable' },
      { href: '/accounts/cash-bank',            label: 'Cash & Bank Management' },
      { href: '/accounts/fixed-assets',         label: 'Fixed Assets Management' },
      { href: '/accounts/payroll',              label: 'Payroll Module' },
      { href: '/accounts/tax',                  label: 'Tax Management' },
      { href: '/accounts/financial-reporting',  label: 'Financial Reporting' },
    ],
  },
  {
    key: 'reports', label: 'Reports', icon: BarChart3, roles: ADMIN_MANAGER,
    tabs: [
      { href: '/reports/sales',          label: 'Sales' },
      { href: '/reports/sale-returns',   label: 'Sale Returns' },
      { href: '/reports/profit-loss',    label: 'P&L' },
      { href: '/reports/stock',          label: 'Stock Reports' },
      { href: '/reports/purchase',       label: 'Purchase Reports' },
      // Kept here until Accounts Receivable is built, then it moves there
      { href: '/reports/aging',          label: 'Receivables Aging' },
    ],
  },
  {
    // No hub-level roles: each tab carries its own. Chart of Accounts is ADMIN + ACCOUNTANT only (its APIs 403 for
    // MANAGER), so an ACCOUNTANT sees a Settings hub containing just that tab and a MANAGER never sees it.
    key: 'settings', label: 'Settings', icon: Settings,
    tabs: [
      { href: '/settings/approvals',         label: 'Approvals',         roles: ADMIN_MANAGER },
      { href: '/settings/areas',             label: 'Areas',             roles: ADMIN_MANAGER },
      { href: '/settings/categories',        label: 'Categories',        roles: ADMIN_MANAGER },
      { href: '/settings/manufacturers',     label: 'Manufacturers',     roles: ADMIN_MANAGER },
      { href: '/settings/chart-of-accounts', label: 'Chart of Accounts', roles: ACCOUNTS },
      { href: '/hr',                         label: 'HR',                roles: ADMIN_MANAGER },
    ],
  },
]

export const allowed = (roles: string[] | undefined, role: string) => !roles || roles.includes(role)

export function visibleTabs(hub: NavHub, role: string): NavTab[] {
  return (hub.tabs ?? []).filter((t) => allowed(t.roles ?? hub.roles, role))
}

/** Hubs the role can see, each with the URL its sidebar link should open (first visible tab). */
export function visibleHubs(role: string): (NavHub & { target: string })[] {
  const out: (NavHub & { target: string })[] = []
  for (const hub of NAV_HUBS) {
    if (hub.href) {
      if (allowed(hub.roles, role)) out.push({ ...hub, target: hub.href })
    } else {
      const tabs = visibleTabs(hub, role)
      if (tabs.length > 0) out.push({ ...hub, target: tabs[0].href })
    }
  }
  return out
}

export const pathMatches = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + '/')

/** A hub is active on its own pages and on their detail/create sub-pages (/orders/new, /retailers/[id], ...). */
export function isHubActive(hub: NavHub, pathname: string): boolean {
  if (hub.href) return pathMatches(pathname, hub.href)
  return (hub.tabs ?? []).some((t) => pathMatches(pathname, t.href))
}

/** The tab bar is shown only on a hub's list pages, i.e. when the path is exactly one of its tabs. */
export function tabBarFor(pathname: string, role: string): { hub: NavHub; tabs: NavTab[] } | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  for (const hub of NAV_HUBS) {
    if (!hub.tabs?.some((t) => t.href === clean)) continue
    const tabs = visibleTabs(hub, role)
    // One visible tab (Order Booker -> Customers, Salesman -> Deliveries) needs no tab bar
    return tabs.length > 1 ? { hub, tabs } : null
  }
  return null
}
