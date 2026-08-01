export const CUSTOMER_TYPES = [
  'Medical Stores',
  'Chain Pharmacy',
  'Hospitals',
  'Institutions',
  'Marts',
  'Pharmacy',
  'WholeSalers',
]

// Employee.role is a plain string in the DB (see prisma/schema.prisma) — these are display-only
// overrides for roles whose label differs from their code (e.g. SALES_REP is shown as "Order
// Booker"), following the same display-only rename pattern already used for Retailer -> Customer.
const ROLE_LABELS: Record<string, string> = {
  SALES_REP: 'ORDER BOOKER',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ')
}

export const ROLES = ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'SALES_REP', 'SALESMAN', 'DRIVER', 'WAREHOUSE', 'ACCOUNTANT'] as const
export type Role = typeof ROLES[number]

export const ROLE_COLORS: Record<Role, string> = {
  ADMIN:       'bg-purple-100 text-purple-800',
  MANAGER:     'bg-blue-100 text-blue-800',
  TEAM_LEAD:   'bg-cyan-100 text-cyan-700',
  SALES_REP:   'bg-green-100 text-green-700',
  SALESMAN:    'bg-teal-100 text-teal-700',
  DRIVER:      'bg-amber-100 text-amber-700',
  WAREHOUSE:   'bg-slate-100 text-slate-700',
  ACCOUNTANT:  'bg-orange-100 text-orange-700',
}

export const ROLE_DESC: Record<Role, string> = {
  ADMIN:      'Full access',
  MANAGER:    'Full access, deletes need admin approval',
  TEAM_LEAD:  'View + orders + payments',
  SALES_REP:  'Own retailers + orders only',
  SALESMAN:   'Deliveries assigned to them + customer name/phone only',
  DRIVER:     'HR/Accounts record only — no ERP login',
  WAREHOUSE:  'Inventory batches only',
  ACCOUNTANT: 'Invoices + supplier payments only',
}
