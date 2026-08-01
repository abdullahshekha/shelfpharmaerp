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
  SALES_REP: 'Order Booker',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ')
}
