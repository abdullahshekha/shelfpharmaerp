import type { Prisma } from '@prisma/client'
import { ensureChart, type SystemKey } from './accounts'
import { toPaisa } from './money'

export type LineInput = {
  accountKey?: SystemKey
  accountId?: string
  debit?: number
  credit?: number
  memo?: string
  retailerId?: string
  supplierId?: string
  employeeId?: string
}

/** Throws unless the lines form a valid balanced entry (compared in integer paisa). */
export function assertBalanced(lines: LineInput[]): void {
  if (!lines || lines.length < 2) throw new Error('A journal entry needs at least two lines')
  let debit = 0
  let credit = 0
  for (const l of lines) {
    const d = toPaisa(l.debit ?? 0)
    const c = toPaisa(l.credit ?? 0)
    if (d < 0 || c < 0) throw new Error('Negative amounts are not allowed')
    if ((d > 0) === (c > 0)) throw new Error('Each line must have exactly one of debit or credit greater than zero')
    debit += d
    credit += c
  }
  if (debit <= 0) throw new Error('Entry total must be greater than zero')
  if (debit !== credit) throw new Error(`Entry is not balanced (debit ${debit / 100} vs credit ${credit / 100})`)
}

export type SettingsDb = Pick<Prisma.TransactionClient, 'accountingSettings'>

/** Returns the single settings row, creating it if absent. */
export async function getSettings(db: SettingsDb) {
  const existing = await db.accountingSettings.findFirst({ orderBy: { updatedAt: 'asc' } })
  if (existing) return existing
  return db.accountingSettings.create({ data: {} })
}

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000

/** Calendar day (Asia/Karachi, UTC+5, no DST) as YYYYMMDD. */
export function karachiDayKey(d: Date): string {
  const k = new Date(d.getTime() + KARACHI_OFFSET_MS)
  return k.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Throws if `date` falls on or before settings.lockedThrough (Karachi calendar days). */
export function assertNotLocked(settings: { lockedThrough: Date | null }, date: Date): void {
  if (!settings.lockedThrough) return
  if (karachiDayKey(date) <= karachiDayKey(settings.lockedThrough)) {
    throw new Error('This date falls in a locked accounting period')
  }
}

export type PostEntryDb = Pick<
  Prisma.TransactionClient,
  'account' | 'accountingSettings' | 'journalEntry' | 'journalLine'
>

export type PostEntryInput = {
  date: Date
  memo?: string
  sourceType?: string
  sourceId?: string
  isManual: boolean
  createdById?: string
  reversesId?: string
  lines: LineInput[]
}

async function nextEntryNumber(tx: PostEntryDb, date: Date): Promise<string> {
  const prefix = `SP-JV-${karachiDayKey(date)}-`
  const last = await tx.journalEntry.findFirst({
    where: { entryNumber: { startsWith: prefix } },
    orderBy: { entryNumber: 'desc' },
    select: { entryNumber: true },
  })
  let n = last ? parseInt(last.entryNumber.slice(prefix.length), 10) || 0 : 0
  // Existence check (not catch-and-retry): a unique violation would abort a Postgres transaction.
  for (let i = 0; i < 20; i++) {
    n += 1
    const candidate = `${prefix}${String(n).padStart(4, '0')}`
    const taken = await tx.journalEntry.findUnique({ where: { entryNumber: candidate }, select: { id: true } })
    if (!taken) return candidate
  }
  throw new Error('Could not allocate a journal entry number')
}

/**
 * Creates one balanced journal entry with its lines. accountKey 'BANK' resolves to
 * AccountingSettings.defaultBankAccountId when set (and the account exists), else the seeded BANK account.
 * Does not check the period lock: manual-posting routes call assertNotLocked; sync skips locked sources.
 */
export async function postEntry(tx: PostEntryDb, input: PostEntryInput) {
  assertBalanced(input.lines)

  const needsKey = input.lines.some((l) => !l.accountId)
  let chart: Awaited<ReturnType<typeof ensureChart>> | null = null
  let bankId: string | null = null
  if (needsKey) {
    chart = await ensureChart(tx)
    if (input.lines.some((l) => !l.accountId && l.accountKey === 'BANK')) {
      const settings = await getSettings(tx)
      if (settings.defaultBankAccountId) {
        const ok = await tx.account.findUnique({
          where: { id: settings.defaultBankAccountId },
          select: { id: true, isActive: true },
        })
        if (ok && ok.isActive) bankId = ok.id
      }
    }
  }

  const lineData = input.lines.map((l) => {
    let accountId = l.accountId
    if (!accountId) {
      if (!l.accountKey) throw new Error('Each line needs an accountId or accountKey')
      accountId = l.accountKey === 'BANK' && bankId ? bankId : chart![l.accountKey]
    }
    return {
      accountId,
      debit: (l.debit ?? 0) > 0 ? toPaisa(l.debit!) / 100 : 0,
      credit: (l.credit ?? 0) > 0 ? toPaisa(l.credit!) / 100 : 0,
      memo: l.memo ?? null,
      retailerId: l.retailerId ?? null,
      supplierId: l.supplierId ?? null,
      employeeId: l.employeeId ?? null,
    }
  })

  const entryNumber = await nextEntryNumber(tx, input.date)
  return tx.journalEntry.create({
    data: {
      entryNumber,
      date: input.date,
      memo: input.memo ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      isManual: input.isManual,
      createdById: input.createdById ?? null,
      reversesId: input.reversesId ?? null,
      lines: { create: lineData },
    },
    include: { lines: true },
  })
}
