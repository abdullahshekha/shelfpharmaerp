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
