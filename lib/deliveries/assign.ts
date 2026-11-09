// Delivery assignment: the moment an order's stock leaves the warehouse.
//
// assignDelivery claims the order INVOICED|ON_HOLD -> OUT_FOR_DELIVERY (conditional updateMany, so a double tap
// assigns once), deducts FEFO for the lines that have not been deducted yet (an On Hold order being re-assigned
// still has its stock out and deducts nothing), records deductedQty/unitCost and dates the COGS posting with
// Delivery.assignedAt. Short stock refuses the whole order (409) before anything is deducted. The ledger is synced
// after commit (syncAfterCommit). unassignDelivery puts the stock back (order -> INVOICED); reassignDelivery only
// changes the driver.
import { prisma } from '@/lib/prisma'
import { AccountingError, assertNotLocked, getSettings } from '@/lib/accounting/core'
import { deductFefo, unitCostFrom } from '@/lib/accounting/cost'
import { assertCogsRemovable, restockOrderItems } from '@/lib/orders/lifecycle'
import { syncAfterCommit } from './sync'
import {
  AssignError,
  canAssign,
  canManageAssignments,
  isValidAssignee,
  hasCurrentOutcome,
  linesToDeduct,
  unitsByMedicine,
} from './assign-rules'

export { AssignError, canAssign, linesToDeduct } from './assign-rules'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
type Actor = { id: string; role: string }

const TX_OPTS = { maxWait: 10000, timeout: 20000 }

function assertActor(actor: Actor) {
  if (!actor?.id || !canManageAssignments(actor.role)) throw new AssignError(403, 'Only an admin or manager can assign deliveries')
}

async function assertAssignee(db: Tx, driverId: string) {
  if (!driverId) throw new AssignError(400, 'Choose who the delivery is assigned to')
  const e = await db.employee.findUnique({ where: { id: driverId }, select: { isActive: true, role: true } })
  if (!isValidAssignee(e)) {
    throw new AssignError(400, 'The delivery can only be assigned to an active driver, salesman, order booker or team lead')
  }
}

/** Locks the order row for the rest of the transaction and returns its current status (null if it is gone). */
async function lockOrder(tx: Tx, orderId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`
  return rows[0]?.status ?? null
}

/** Maps an AccountingError raised inside a transaction to an AssignError with the same status/message. */
function asAssignError(e: unknown): never {
  if (e instanceof AccountingError) throw new AssignError(e.status, e.message)
  throw e
}

export async function assignDelivery(deliveryId: string, driverId: string, actor: Actor): Promise<{ warnings: string[] }> {
  assertActor(actor)
  const warnings: string[] = []

  const orderId = await prisma.$transaction(async (tx) => {
    await assertAssignee(tx, driverId)
    const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { id: true, orderId: true } })
    if (!delivery) throw new AssignError(404, 'Delivery not found')
    const order = await tx.order.findUnique({ where: { id: delivery.orderId }, select: { id: true, status: true } })
    if (!order) throw new AssignError(404, 'Order not found')
    if (!canAssign(order.status, actor.role)) throw new AssignError(409, `Cannot assign a delivery whose order is ${order.status}`)

    // Claim: only one request can move this order into OUT_FOR_DELIVERY (the second waits on the row lock, then
    // sees the new status and gets count 0).
    const claim = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: 'OUT_FOR_DELIVERY' } })
    if (claim.count === 0) throw new AssignError(409, 'This delivery was already assigned or changed, reload and retry')

    // A first assignment dates the COGS posting now (a re-assignment after On Hold keeps the original date); refuse
    // rather than post into a locked period. Re-read under the claimed row so the value is current.
    const current = await tx.delivery.findUnique({ where: { id: delivery.id }, select: { assignedAt: true } })
    const assignedAt = current?.assignedAt ?? new Date()
    if (!current?.assignedAt) {
      const settings = await getSettings(tx)
      if (settings.goLiveDate && assignedAt >= settings.goLiveDate) {
        try {
          assertNotLocked(settings, assignedAt)
        } catch {
          throw new AssignError(409, 'Cannot assign: today falls in a locked accounting period')
        }
      }
    }

    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      include: { medicine: { select: { name: true } } },
      orderBy: { id: 'asc' },
    })
    const lines = linesToDeduct(items)
    const needed = unitsByMedicine(lines)
    const medicineIds = Array.from(needed.keys()).sort()

    // Lock the medicines' batch rows (sorted, so concurrent assignments cannot deadlock): availability checked
    // below cannot be taken by another assignment before this one deducts.
    for (const medicineId of medicineIds) {
      await tx.$queryRaw`SELECT "id" FROM "MedicineBatch" WHERE "medicineId" = ${medicineId} FOR UPDATE`
    }

    // Check every medicine BEFORE deducting anything: one short line refuses the whole order (throwing rolls back).
    for (const medicineId of medicineIds) {
      const agg = await tx.medicineBatch.aggregate({ where: { medicineId, currentQty: { gt: 0 } }, _sum: { currentQty: true } })
      const available = agg._sum.currentQty ?? 0
      if (available < needed.get(medicineId)!) {
        const name = lines.find((l) => l.medicineId === medicineId)?.medicine?.name ?? medicineId
        throw new AssignError(409, `Not enough stock for ${name}`)
      }
    }

    for (const line of lines) {
      const { costSum, deducted, remaining } = await deductFefo(tx, line.medicineId, line.units)
      if (remaining > 0) throw new AssignError(409, `Not enough stock for ${line.medicine?.name ?? line.medicineId}`)
      // Bonus units come off the shelf too; unitCost stays per ORDERED unit so quantity x unitCost (the COGS
      // posting) covers the cost of the free units as well. A bonus-only line (quantity 0) has no per-unit cost.
      await tx.orderItem.update({
        where: { id: line.id },
        data: { deductedQty: deducted, ...(line.quantity > 0 ? { unitCost: unitCostFrom(costSum, line.quantity) } : {}) },
      })
    }

    await tx.delivery.update({
      where: { id: delivery.id },
      data: { driverId, assignedAt, status: 'OUT_FOR_DELIVERY' },
    })
    return order.id
  }, TX_OPTS).catch(asAssignError)

  await syncAfterCommit([['DELIVERY_COGS', orderId]])
  return { warnings }
}

/** Assigns several deliveries to one driver, one transaction each: a refused one does not stop the others. */
export async function assignDeliveries(
  ids: string[],
  driverId: string,
  actor: Actor,
): Promise<{ assigned: string[]; refused: { id: string; error: string }[] }> {
  assertActor(actor)
  const assigned: string[] = []
  const refused: { id: string; error: string }[] = []
  for (const id of Array.from(new Set(ids))) {
    try {
      await assignDelivery(id, driverId, actor)
      assigned.push(id)
    } catch (e) {
      if (e instanceof AssignError) refused.push({ id, error: e.message })
      else {
        console.error('assignDeliveries', id, e)
        refused.push({ id, error: 'Could not assign this delivery' })
      }
    }
  }
  return { assigned, refused }
}

/**
 * Takes a delivery back before any outcome: the order returns to INVOICED, what is still out is restocked,
 * unitCost/deductedQty are cleared (so the COGS entry is removed on sync), and the driver and assignedAt are cleared.
 */
export async function unassignDelivery(deliveryId: string, actor: Actor): Promise<{ warnings: string[] }> {
  assertActor(actor)
  const { orderId, warnings } = await prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { id: true, orderId: true } })
    if (!delivery) throw new AssignError(404, 'Delivery not found')
    const status = await lockOrder(tx, delivery.orderId)
    if (!status) throw new AssignError(404, 'Order not found')
    if (status !== 'OUT_FOR_DELIVERY') throw new AssignError(409, `Cannot un-assign a delivery whose order is ${status}`)
    // Read the outcome under the order lock (recording an outcome claims the same order row).
    const fresh = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { outcome: true } })
    if (hasCurrentOutcome(fresh?.outcome)) throw new AssignError(409, 'An outcome has already been recorded for this delivery')

    const claim = await tx.order.updateMany({ where: { id: delivery.orderId, status: 'OUT_FOR_DELIVERY' }, data: { status: 'INVOICED' } })
    if (claim.count === 0) throw new AssignError(409, 'This delivery changed, reload and retry')
    await assertCogsRemovable(tx, delivery.orderId)
    const w = await restockOrderItems(tx, delivery.orderId, 'OUT_FOR_DELIVERY')
    await tx.delivery.update({ where: { id: deliveryId }, data: { driverId: null, assignedAt: null, status: 'SCHEDULED' } })
    return { orderId: delivery.orderId, warnings: w }
  }, TX_OPTS).catch(asAssignError)

  await syncAfterCommit([['DELIVERY_COGS', orderId]])
  return { warnings }
}

/** Hands an assigned delivery (no outcome yet) to another driver. No stock or ledger effect. */
export async function reassignDelivery(deliveryId: string, driverId: string, actor: Actor): Promise<void> {
  assertActor(actor)
  await prisma.$transaction(async (tx) => {
    await assertAssignee(tx, driverId)
    const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { id: true, orderId: true } })
    if (!delivery) throw new AssignError(404, 'Delivery not found')
    const status = await lockOrder(tx, delivery.orderId)
    if (!status) throw new AssignError(404, 'Order not found')
    if (status !== 'OUT_FOR_DELIVERY') throw new AssignError(409, `Cannot re-assign a delivery whose order is ${status}`)
    const fresh = await tx.delivery.findUnique({ where: { id: deliveryId }, select: { outcome: true } })
    if (hasCurrentOutcome(fresh?.outcome)) throw new AssignError(409, 'An outcome has already been recorded for this delivery')
    await tx.delivery.update({ where: { id: deliveryId }, data: { driverId } })
  }, TX_OPTS).catch(asAssignError)
}
