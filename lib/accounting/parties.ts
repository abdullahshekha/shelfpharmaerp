import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPaisa } from './money'

export type PartyKind = 'receivable' | 'payable'

export interface PartyBalance {
  id: string
  name: string
  ledger: number // ledger balance in the account's normal direction (AR debit-normal, AP credit-normal)
  invoice: number // invoice-derived outstanding (existing sub-ledger logic)
  difference: number // ledger - invoice
}

export const SYSTEM_KEY: Record<PartyKind, 'AR' | 'AP'> = { receivable: 'AR', payable: 'AP' }

const p2 = (n: unknown) => toPaisa(Number(n ?? 0))

/**
 * Every party that either has ledger lines on the AR/AP account or a non-zero invoice-derived outstanding,
 * computed with a fixed number of grouped queries (no per-party queries).
 *
 * Invoice-derived outstanding mirrors the existing screens, except that payments recorded against a
 * part-paid invoice are netted off (the customer page uses the gross invoice total):
 *  - customer: unpaid (UNPAID/PARTIAL/OVERDUE; DRAFT excluded) invoices - payments on them - sales returns
 *  - supplier: non-PAID purchase invoices - payments - supplier returns (computeSupplierOutstanding)
 */
export async function loadPartyBalances(kind: PartyKind): Promise<{ accountId: string | null; parties: PartyBalance[] }> {
  const account = await prisma.account.findUnique({ where: { systemKey: SYSTEM_KEY[kind] }, select: { id: true } })
  const accountId = account?.id ?? null
  const sign = kind === 'receivable' ? 1 : -1

  const ledgerRows = accountId
    ? kind === 'receivable'
      ? await prisma.$queryRaw<{ id: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
          SELECT "retailerId" AS id, SUM(debit) AS debit, SUM(credit) AS credit FROM "JournalLine"
          WHERE "accountId" = ${accountId} AND "retailerId" IS NOT NULL GROUP BY "retailerId"`
      : await prisma.$queryRaw<{ id: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
          SELECT "supplierId" AS id, SUM(debit) AS debit, SUM(credit) AS credit FROM "JournalLine"
          WHERE "accountId" = ${accountId} AND "supplierId" IS NOT NULL GROUP BY "supplierId"`
    : []

  const invoiceRows =
    kind === 'receivable'
      ? await prisma.$queryRaw<{ id: string; amount: Prisma.Decimal }[]>`
          SELECT i."retailerId" AS id, SUM(i."totalAmount" - COALESCE(p.paid, 0)) AS amount
          FROM "Invoice" i
          LEFT JOIN (SELECT "invoiceId", SUM(amount) AS paid FROM "Payment" WHERE "invoiceId" IS NOT NULL GROUP BY "invoiceId") p ON p."invoiceId" = i.id
          WHERE i.status IN ('UNPAID', 'PARTIAL', 'OVERDUE') GROUP BY i."retailerId"`
      : await prisma.$queryRaw<{ id: string; amount: Prisma.Decimal }[]>`
          SELECT i."supplierId" AS id, SUM(i."totalAmount" - COALESCE(p.paid, 0)) AS amount
          FROM "PurchaseInvoice" i
          LEFT JOIN (SELECT "purchaseInvoiceId", SUM(amount) AS paid FROM "SupplierPayment" GROUP BY "purchaseInvoiceId") p ON p."purchaseInvoiceId" = i.id
          WHERE i.status <> 'PAID' GROUP BY i."supplierId"`
  const returnRows =
    kind === 'receivable'
      ? await prisma.salesReturn.groupBy({ by: ['retailerId'], _sum: { totalAmount: true } }).then((r) => r.map((x) => ({ id: x.retailerId, amount: x._sum.totalAmount })))
      : await prisma.supplierReturn.groupBy({ by: ['supplierId'], _sum: { totalAmount: true } }).then((r) => r.map((x) => ({ id: x.supplierId, amount: x._sum.totalAmount })))

  const ledger = new Map<string, number>()
  for (const r of ledgerRows) ledger.set(r.id, sign * (p2(r.debit) - p2(r.credit)))
  const invoice = new Map<string, number>()
  for (const r of invoiceRows) invoice.set(r.id, (invoice.get(r.id) ?? 0) + p2(r.amount))
  for (const r of returnRows) invoice.set(r.id, (invoice.get(r.id) ?? 0) - p2(r.amount))

  const ids = Array.from(new Set([...Array.from(ledger.keys()), ...Array.from(invoice.entries()).filter(([, v]) => v !== 0).map(([k]) => k)]))
  const names = ids.length
    ? kind === 'receivable'
      ? await prisma.retailer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : []
  const nameOf = new Map(names.map((n) => [n.id, n.name]))

  const parties: PartyBalance[] = ids.map((id) => {
    const l = ledger.get(id) ?? 0
    const i = invoice.get(id) ?? 0
    return { id, name: nameOf.get(id) ?? '(deleted party)', ledger: l / 100, invoice: i / 100, difference: (l - i) / 100 }
  })
  return { accountId, parties }
}
