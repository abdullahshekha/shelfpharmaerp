import { prisma } from '@/lib/prisma'
import { parseDateInput } from '@/lib/accounting/dates'
import { canCreateCheque, canManageCheques, validatePartyShape } from './guard'
import { chequeDuplicateKey, duplicateChequeMessage, type ChequeDirection } from './rules'

export class ChequeError extends Error {
  /** `extra` is merged into the JSON error body (e.g. `{ duplicate: true }` so the UI can offer "Record anyway?"). */
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

export const ROLE_CANNOT_RECORD = 'Your role cannot record cheques'

type Db = Pick<typeof prisma, 'cheque'>

/**
 * 409 when the same physical cheque (direction + party + number, trimmed, case-insensitive, any status) is already
 * recorded, unless the caller explicitly allows a duplicate (same number from a different drawer bank).
 */
export async function assertNotDuplicate(
  db: Db,
  c: { direction: ChequeDirection; retailerId: string | null; supplierId: string | null; chequeNumber: string; excludeId?: string },
): Promise<void> {
  const existing = await db.cheque.findFirst({
    where: {
      direction: c.direction,
      ...(c.direction === 'RECEIVABLE' ? { retailerId: c.retailerId } : { supplierId: c.supplierId }),
      chequeNumber: { equals: c.chequeNumber.trim(), mode: 'insensitive' },
      ...(c.excludeId ? { NOT: { id: c.excludeId } } : {}),
    },
    select: { id: true, chequeNumber: true, status: true },
  })
  if (existing) {
    throw new ChequeError(409, duplicateChequeMessage(existing.chequeNumber, c.direction, existing.status), { duplicate: true, existingId: existing.id })
  }
}

export type ChequeInput = {
  direction?: unknown; chequeNumber?: unknown; amount?: unknown; chequeDate?: unknown
  receivedDate?: unknown; retailerId?: unknown; supplierId?: unknown; bankAccountId?: unknown
  drawerBank?: unknown; pictureUrl?: unknown; notes?: unknown; allowDuplicate?: unknown
}

/** Parses an amount into a Decimal(12,2)-safe number; throws ChequeError otherwise. */
export function parseChequeAmount(v: unknown): number {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new ChequeError(400, 'Amount must be a positive number with at most 2 decimals')
  const n = Number(s)
  if (!(n > 0) || n >= 1e10) throw new ChequeError(400, 'Amount must be greater than 0')
  return n
}

export function optStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** An active ASSET account with subType BANK, or throws 400. */
export async function assertBankAccount(id: string): Promise<void> {
  const acc = await prisma.account.findUnique({ where: { id }, select: { type: true, subType: true, isActive: true } })
  if (!acc || !acc.isActive || acc.type !== 'ASSET' || acc.subType !== 'BANK') {
    throw new ChequeError(400, 'Bank account must be an active bank (asset) account')
  }
}

/** Validates exactly one party matching the direction and that it exists; throws ChequeError. */
export async function resolveParty(direction: ChequeDirection, retailerIn: unknown, supplierIn: unknown) {
  const retailerId = optStr(retailerIn)
  const supplierId = optStr(supplierIn)
  const bad = validatePartyShape(direction, retailerId, supplierId)
  if (bad) throw new ChequeError(400, bad)
  if (direction === 'RECEIVABLE') {
    const r = await prisma.retailer.findUnique({ where: { id: retailerId! }, select: { id: true } })
    if (!r) throw new ChequeError(404, 'Customer not found')
  } else {
    const sp = await prisma.supplier.findUnique({ where: { id: supplierId! }, select: { id: true } })
    if (!sp) throw new ChequeError(404, 'Supplier not found')
  }
  return { retailerId, supplierId }
}

export async function createChequeRecord(user: { id: string; role: string }, input: ChequeInput) {
  const direction = input.direction
  if (direction !== 'RECEIVABLE' && direction !== 'PAYABLE') throw new ChequeError(400, 'Invalid direction')
  if (!user.id || !canCreateCheque(user.role, direction as ChequeDirection)) {
    throw new ChequeError(403, ROLE_CANNOT_RECORD)
  }
  const chequeNumber = optStr(input.chequeNumber)
  if (!chequeNumber) throw new ChequeError(400, 'Cheque number is required')
  const amount = parseChequeAmount(input.amount)
  const chequeDate = parseDateInput(input.chequeDate)
  if (!chequeDate) throw new ChequeError(400, 'Valid cheque date is required')
  let receivedDate = new Date()
  if (input.receivedDate != null && input.receivedDate !== '') {
    const d = parseDateInput(input.receivedDate)
    if (!d) throw new ChequeError(400, 'Invalid received date')
    receivedDate = d
  }

  const { retailerId, supplierId } = await resolveParty(direction as ChequeDirection, input.retailerId, input.supplierId)

  const bankAccountId = optStr(input.bankAccountId)
  if (bankAccountId) await assertBankAccount(bankAccountId)

  const auto = canManageCheques(user.role)
  const partyId = (retailerId ?? supplierId)!
  // Serialise creates of the same cheque so two concurrent requests cannot both pass the duplicate check.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'PDC_CHEQUE:' + chequeDuplicateKey(direction as ChequeDirection, partyId, chequeNumber)}))`
    if (input.allowDuplicate !== true) {
      await assertNotDuplicate(tx, { direction: direction as ChequeDirection, retailerId, supplierId, chequeNumber })
    }
    return tx.cheque.create({
      data: {
        direction, chequeNumber, amount, chequeDate, receivedDate,
        retailerId, supplierId, bankAccountId,
        drawerBank: optStr(input.drawerBank),
        pictureUrl: optStr(input.pictureUrl),
        notes: optStr(input.notes),
        recordedById: user.id,
        acknowledgedAt: auto ? new Date() : null,
        acknowledgedById: auto ? user.id : null,
      },
    })
  }, { maxWait: 10000, timeout: 15000 })
}
