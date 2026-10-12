// Shared "how much is still owed" logic for customer (sales) invoices.
//
// Formula (per invoice):  due = max(0, totalAmount - sum(payments on that invoice)),
// counted only for invoices whose status is UNPAID / PARTIAL / OVERDUE (DRAFT = void, PAID = settled).
// Customer outstanding = sum(due over their invoices) - sum(sales-return credits).
//
// BEFORE (customer page + dashboard): sum(totalAmount) of those invoices - returns, i.e. payments recorded
// against a PARTIAL invoice were NOT subtracted, so the figure overstated what the customer owed.

export const OUTSTANDING_STATUSES = ['UNPAID', 'PARTIAL', 'OVERDUE'] as const

type Num = number | string | { toString(): string } | null | undefined
const paisa = (v: Num) => Math.round(Number(v ?? 0) * 100 + 1e-7)

export interface OutstandingInvoice {
  retailerId?: string
  status: string
  totalAmount: Num
  payments?: { amount: Num }[]
}

/** Paisa still due on one invoice (never negative); 0 for statuses that carry no balance. */
export function invoiceDuePaisa(inv: OutstandingInvoice, opts: { allowNegative?: boolean } = {}): number {
  if (!(OUTSTANDING_STATUSES as readonly string[]).includes(inv.status)) return 0
  const paid = (inv.payments ?? []).reduce((s, p) => s + paisa(p.amount), 0)
  const due = paisa(inv.totalAmount) - paid
  return opts.allowNegative ? due : Math.max(0, due)
}

/** Due paisa grouped by retailerId (invoices without a retailerId go under ''). */
export function dueByRetailer(invoices: OutstandingInvoice[], opts: { allowNegative?: boolean } = {}): Map<string, number> {
  const out = new Map<string, number>()
  for (const inv of invoices) {
    const key = inv.retailerId ?? ''
    out.set(key, (out.get(key) ?? 0) + invoiceDuePaisa(inv, opts))
  }
  return out
}

/** Outstanding rupees = sum of invoice dues minus return credits (rupees). */
export function outstandingRupees(invoices: OutstandingInvoice[], returnCredits: Num = 0): number {
  const due = invoices.reduce((s, i) => s + invoiceDuePaisa(i), 0)
  return (due - paisa(returnCredits)) / 100
}

// Minimal structural type so this module does not import the Prisma singleton (keeps it unit-testable).
interface InvoiceDb {
  invoice: { findMany: (args: any) => Promise<any[]> } // eslint-disable-line @typescript-eslint/no-explicit-any
  salesReturn: { aggregate: (args: any) => Promise<{ _sum?: { totalAmount?: Num } }> } // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Loads open invoices (+ their payments) and return credits; scope to one customer with `retailerId`. */
export async function loadReceivableOutstanding(db: InvoiceDb, retailerId?: string) {
  const invoices = (await db.invoice.findMany({
    where: { ...(retailerId && { retailerId }), status: { in: [...OUTSTANDING_STATUSES] } },
    select: { retailerId: true, status: true, totalAmount: true, payments: { select: { amount: true } } },
  })) as OutstandingInvoice[]
  const credits = await db.salesReturn.aggregate({ where: retailerId ? { retailerId } : {}, _sum: { totalAmount: true } })
  const returnCredits = Number(credits._sum?.totalAmount ?? 0)
  return { invoices, returnCredits, outstanding: outstandingRupees(invoices, returnCredits) }
}
