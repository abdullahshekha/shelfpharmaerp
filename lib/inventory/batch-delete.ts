// Stock batch deletion, shared by DELETE /api/inventory/[id]/batches (ADMIN) and the approvals executor (MANAGER).
//
// When the Accounts module is live (go-live date set and now >= go-live) the batch's remaining stock is written off
// in the SAME transaction as the delete: Dr OTHER_EXPENSES / Cr INVENTORY, currentQty x purchasePrice, dated now,
// sourceType BATCH_WRITEOFF, sourceId = batch id (never touched by sync/rebuild). A locked current period refuses
// the delete (409). When the module is not live the delete behaves exactly as before (no posting).
// FK behaviour is unchanged: PurchaseInvoiceItem/SalesReturnItem.batchId are nulled by the database (SetNull),
// a SupplierReturnItem reference blocks the delete (Restrict) and rolls the whole transaction back.
import { prisma } from '@/lib/prisma'
import { AccountingError, assertNotLocked, getSettings, postEntry } from '@/lib/accounting/core'
import { buildBatchWriteoff } from '@/lib/accounting/builders'

export const LOCKED_STOCK_MESSAGE = 'Cannot delete stock: accounting period is locked'

export async function deleteBatch(
  batchId: string,
  opts: { medicineId?: string; userId?: string } = {},
): Promise<{ writtenOff: number; entryNumber: string | null }> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'BATCH_WRITEOFF:' + batchId}))`
      const batch = await tx.medicineBatch.findFirst({
        where: { id: batchId, ...(opts.medicineId ? { medicineId: opts.medicineId } : {}) },
        include: { medicine: { select: { name: true } } },
      })
      if (!batch) throw new AccountingError(404, 'Batch not found')

      const now = new Date()
      const settings = await getSettings(tx)
      const live = !!settings.goLiveDate && now.getTime() >= settings.goLiveDate.getTime()
      let writtenOff = 0
      let entryNumber: string | null = null
      if (live) {
        try {
          assertNotLocked(settings, now)
        } catch {
          throw new AccountingError(409, LOCKED_STOCK_MESSAGE)
        }
        const built = buildBatchWriteoff({
          date: now,
          medicineName: batch.medicine.name,
          batchNumber: batch.batchNumber,
          quantity: batch.currentQty,
          purchasePrice: Number(batch.purchasePrice),
        })
        for (const e of built) {
          const entry = await postEntry(tx, {
            date: e.date,
            memo: e.memo,
            sourceType: 'BATCH_WRITEOFF',
            sourceId: batch.id,
            isManual: false,
            createdById: opts.userId,
            lines: e.lines,
          })
          entryNumber = entry.entryNumber
          writtenOff += e.lines.reduce((s, l) => s + Math.round((l.debit ?? 0) * 100), 0) / 100
        }
      }
      await tx.medicineBatch.delete({ where: { id: batch.id } })
      return { writtenOff, entryNumber }
    },
    { maxWait: 10000, timeout: 15000 },
  )
}
