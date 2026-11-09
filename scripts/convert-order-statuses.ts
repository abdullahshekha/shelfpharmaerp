// One-off conversion of legacy Order statuses to the new vocabulary (Phase 18).
//   npx tsx scripts/convert-order-statuses.ts                       dry run: counts + what each order becomes (read-only)
//   npx tsx scripts/convert-order-statuses.ts --apply --backup <file.json>
// --apply refuses to run without --backup <path>; the backup (every affected order with items and delivery) is
// written BEFORE anything changes. DRAFT orders are deleted through the audited client (items cascade).
// Orders that become OUT_FOR_DELIVERY without ever having had stock deducted are listed for manual review: they
// cannot be auto-deducted. NEVER run --apply against production without the owner's go-ahead.
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { prisma } from '../lib/prisma'
import { planConversion } from '../lib/orders/convert'

async function main() {
  const apply = process.argv.includes('--apply')
  const bi = process.argv.indexOf('--backup')
  const backupPath = bi >= 0 ? process.argv[bi + 1] : undefined
  if (apply && (!backupPath || backupPath.startsWith('--'))) {
    console.error('Refusing to --apply without --backup <path>')
    process.exit(1)
  }

  const orders = await prisma.order.findMany({
    include: { items: { select: { deductedQty: true } }, delivery: { select: { status: true } } },
  })
  const plan = planConversion(orders.map((o) => ({
    id: o.id, orderNumber: o.orderNumber, status: o.status, deliveryStatus: o.delivery?.status ?? null, items: o.items,
  })))

  console.log(`${apply ? '' : '[dry-run] '}orders by current status:`, plan.counts)
  for (const u of plan.updates) console.log(`  ${u.orderNumber}: ${u.from} -> ${u.to}${u.deliveryStatus ? ` (delivery -> ${u.deliveryStatus})` : ''}`)
  for (const id of plan.deletes) console.log(`  ${orders.find((o) => o.id === id)!.orderNumber}: DRAFT -> deleted`)
  if (plan.review.length) {
    console.log('NEEDS MANUAL REVIEW (stock never deducted):')
    for (const r of plan.review) console.log(`  ${r.orderNumber}: ${r.reason}`)
  }
  if (!apply) { console.log('Dry run only. Nothing was changed.'); return }

  const affected = Array.from(new Set([...plan.updates.map((u) => u.id), ...plan.deletes]))
  const dump = await prisma.order.findMany({ where: { id: { in: affected } }, include: { items: true, delivery: true } })
  writeFileSync(backupPath!, JSON.stringify({ takenAt: new Date().toISOString(), orders: dump }, null, 2))
  console.log(`backup written: ${backupPath} (${dump.length} orders)`)

  for (const u of plan.updates) {
    await prisma.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { id: u.id, status: u.from }, data: { status: u.to } })
      if (u.deliveryStatus) await tx.delivery.updateMany({ where: { orderId: u.id }, data: { status: u.deliveryStatus, assignedAt: null } })
    })
  }
  for (const id of plan.deletes) {
    // Single delete (not deleteMany) so the audit log snapshots the cascaded items.
    const still = await prisma.order.findFirst({ where: { id, status: 'DRAFT' }, select: { id: true } })
    if (still) await prisma.order.delete({ where: { id } })
  }
  console.log(`converted ${plan.updates.length}, deleted ${plan.deletes.length}, review ${plan.review.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
