// Pure PDC role rules. No Prisma/db imports.
import type { ChequeDirection } from './rules'

const MANAGERS = ['ADMIN', 'MANAGER', 'ACCOUNTANT']

export function canManageCheques(role: string): boolean {
  return MANAGERS.includes(role)
}

export function canAcknowledge(role: string): boolean {
  return role === 'ADMIN' || role === 'MANAGER'
}

export function canCreateCheque(role: string, direction: ChequeDirection): boolean {
  if (canManageCheques(role)) return true
  return role === 'SALESMAN' && direction === 'RECEIVABLE'
}

/** 'FULL' = all editable fields, 'NOTES' = notes only (cleared cheque), false = none. */
export function canEditCheque(
  user: { id: string; role: string },
  cheque: { status: string; recordedById: string | null; acknowledgedAt: Date | null },
): 'FULL' | 'NOTES' | false {
  if (canManageCheques(user.role)) return cheque.status === 'CLEARED' ? 'NOTES' : 'FULL'
  if (
    user.role === 'SALESMAN' &&
    cheque.recordedById === user.id &&
    !cheque.acknowledgedAt &&
    cheque.status !== 'CLEARED'
  ) return 'FULL'
  return false
}

/** Only managers may change a cheque's party (a salesman may not, even on his own cheque). */
export function canEditParty(role: string): boolean {
  return canManageCheques(role)
}

/** Pure shape check: exactly one party, matching the direction. Returns an error message or null. */
export function validatePartyShape(
  direction: ChequeDirection,
  retailerId: string | null,
  supplierId: string | null,
): string | null {
  if (direction === 'RECEIVABLE') {
    return !retailerId || supplierId ? 'A receivable cheque needs exactly one customer' : null
  }
  return !supplierId || retailerId ? 'A payable cheque needs exactly one supplier' : null
}
