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
  const existing = await db.accountingSettings.findFirst({ orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }] })
  if (existing) return existing
  // Fixed id so concurrent first calls can only ever produce one row.
  return db.accountingSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } })
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
  'account' | 'accountingSettings' | 'journalEntry' | 'journalLine' | '$executeRaw' | '$queryRaw'
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
  // Serialise number allocation per day for the rest of this transaction: concurrent posters
  // wait here, then see each other's committed entries, so two can never pick the same number
  // (a unique violation would abort the caller's whole Postgres transaction).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`
  // Numeric max of the suffix (string ordering breaks past 9999).
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("entryNumber" FROM CAST(${prefix.length + 1} AS INTEGER)) AS INTEGER)) AS max
    FROM "JournalEntry"
    WHERE "entryNumber" LIKE ${prefix + '%'}
      AND SUBSTRING("entryNumber" FROM CAST(${prefix.length + 1} AS INTEGER)) ~ '^[0-9]+$'`
  const n = Number(rows[0]?.max ?? 0) + 1
  return `${prefix}${String(n).padStart(4, '0')}`
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

/** A domain error the API layer may safely turn into a 4xx. Anything else is a 500. */
export class AccountingError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Manual postings (and reversals) need a go-live date, must be on/after it, and must not be in a locked period. */
export function assertManualPostable(settings: { goLiveDate: Date | null; lockedThrough: Date | null }, date: Date): void {
  if (!settings.goLiveDate) throw new AccountingError(409, 'Set a go-live date in Accounts Settings before posting journal entries')
  if (date.getTime() < settings.goLiveDate.getTime()) throw new AccountingError(400, 'Entry date is before the go-live date')
  try {
    assertNotLocked(settings, date)
  } catch (e) {
    throw new AccountingError(409, (e as Error).message)
  }
}
