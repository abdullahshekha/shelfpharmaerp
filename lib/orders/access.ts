// Who may read orders through /api/orders*. Roles whose screens are My Deliveries only (they use /api/deliveries)
// cannot list orders and can open one only when it is their own delivery.
const ASSIGNEE_ONLY = ['DRIVER', 'SALESMAN', 'SALES_REP']

export function canListOrders(role: string): boolean {
  return !ASSIGNEE_ONLY.includes(role)
}

export function canViewOrder(role: string, userId: string, deliveryDriverId: string | null | undefined): boolean {
  if (!ASSIGNEE_ONLY.includes(role)) return true
  return !!userId && deliveryDriverId === userId
}
