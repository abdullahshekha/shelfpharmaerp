// Backfills MedicineBatch.salesTax from the linked PurchaseInvoiceItem.salesTax (via batchId).
// Only sets it where it is currently null; never overwrites. Usage:
//   npx tsx scripts/backfill-batch-sales-tax.ts --dry-run
//   npx tsx scripts/backfill-batch-sales-tax.ts
import 'dotenv/config'
import { prisma } from '../lib/prisma'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const items = await prisma.purchaseInvoiceItem.findMany({
    where: { batchId: { not: null }, batch: { is: { salesTax: null } } },
    select: { id: true, batchId: true, salesTax: true },
  })
  console.log(`${dryRun ? '[dry-run] ' : ''}batches with null salesTax and a linked purchase item: ${items.length}`)
  if (dryRun) return
  let updated = 0
  for (const it of items) {
    const r = await prisma.medicineBatch.updateMany({
      where: { id: it.batchId!, salesTax: null },
      data: { salesTax: it.salesTax },
    })
    updated += r.count
  }
  console.log(`updated: ${updated}`)
}
main().finally(() => prisma.$disconnect())
