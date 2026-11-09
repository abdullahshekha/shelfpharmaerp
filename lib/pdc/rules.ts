// Pure PDC (post-dated cheque) rules. No Prisma/db imports.

export type ChequeStatus = 'PENDING' | 'STOPPED' | 'RETURNED' | 'CLEARED'
export type ChequeDirection = 'RECEIVABLE' | 'PAYABLE'

const TRANSITIONS: Record<ChequeStatus, ChequeStatus[]> = {
  PENDING: ['STOPPED', 'RETURNED', 'CLEARED'],
  STOPPED: ['PENDING'],
  RETURNED: ['PENDING'],
  CLEARED: [],
}

export function canTransition(from: ChequeStatus, to: ChequeStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export type OpenInvoice = { id: string; duePaisa: number; sortDate: Date; createdAt: Date }

export function allocateOldestFirst(
  invoices: OpenInvoice[],
  amountPaisa: number,
): { allocations: { invoiceId: string; paisa: number }[]; remainderPaisa: number } {
  const sorted = [...invoices].sort(
    (a, b) =>
      a.sortDate.getTime() - b.sortDate.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  )
  const allocations: { invoiceId: string; paisa: number }[] = []
  let left = Math.max(0, amountPaisa)
  for (const inv of sorted) {
    if (left <= 0) break
    if (inv.duePaisa <= 0) continue
    const paisa = Math.min(inv.duePaisa, left)
    allocations.push({ invoiceId: inv.id, paisa })
    left -= paisa
  }
  return { allocations, remainderPaisa: left }
}

/** Cheque numbers compare trimmed and case-insensitive (the DB stores them trimmed). */
export function normalizeChequeNumber(n: string): string {
  return n.trim().toLowerCase()
}

/** Identity of a physical cheque: same direction + party + number = the same cheque. */
export function chequeDuplicateKey(direction: ChequeDirection, partyId: string, chequeNumber: string): string {
  return `${direction}:${partyId}:${normalizeChequeNumber(chequeNumber)}`
}

export function duplicateChequeMessage(chequeNumber: string, direction: ChequeDirection, status: string): string {
  return `Cheque ${chequeNumber} is already recorded for this ${direction === 'RECEIVABLE' ? 'customer' : 'supplier'} (status ${status})`
}

/**
 * Hard-deleting an order deletes its invoice's payments. A payment created by clearing a cheque must never vanish
 * (Cleared is final and its money is in the bank), so this returns the refusal message, or null when none is linked.
 */
export function clearedChequeDeleteBlock(payments: { chequeId: string | null; chequeNumber?: string | null }[]): string | null {
  const linked = payments.filter((p) => p.chequeId)
  if (linked.length === 0) return null
  const numbers = Array.from(new Set(linked.map((p) => p.chequeNumber ?? p.chequeId)))
  return `Paid by cleared cheque ${numbers.join(', ')}; cannot delete.`
}
