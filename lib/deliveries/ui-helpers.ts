// Pure UI rules for the Deliveries board (no Prisma imports). Mirrors the server: only ADMIN/MANAGER assign,
// reassign or un-assign; an outcome is recorded by a manager/admin or by the delivery's own assignee while it is
// Out for Delivery. The API stays the authority, this only decides what the UI offers.
import type { BoardColumn } from '@/lib/orders/status'
import { ASSIGNEE_ROLES, canManageAssignments } from './assign-rules'

export type CardAction = 'assign' | 'reassign' | 'unassign' | 'outcome'

export function cardActions(
  role: string,
  userId: string,
  // stockOut false = a line never had its stock deducted (converted DISPATCHED order): the server refuses an outcome
  // until it is un-assigned and assigned again, so the outcome action is not offered.
  delivery: { driverId: string | null; stockOut?: boolean },
  column: BoardColumn,
): CardAction[] {
  const all = baseCardActions(role, userId, delivery, column)
  return delivery.stockOut === false ? all.filter((a) => a !== 'outcome') : all
}

function baseCardActions(
  role: string,
  userId: string,
  delivery: { driverId: string | null },
  column: BoardColumn,
): CardAction[] {
  if (!userId) return []
  if (canManageAssignments(role)) {
    if (column === 'READY') return ['assign']
    if (column === 'ASSIGNED') return ['reassign', 'unassign', 'outcome']
    return []
  }
  if ((ASSIGNEE_ROLES as readonly string[]).includes(role) && column === 'ASSIGNED' && delivery.driverId === userId) {
    return ['outcome']
  }
  return []
}
