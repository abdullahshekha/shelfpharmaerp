import type { Prisma } from '@prisma/client'

export type SystemKey =
  | 'CASH'
  | 'BANK'
  | 'AR'
  | 'INVENTORY'
  | 'ADV_TAX_RECOVERABLE'
  | 'SALES_TAX_INPUT'
  | 'FIXED_ASSETS'
  | 'ACCUM_DEPRECIATION'
  | 'AP'
  | 'SALES_TAX_PAYABLE'
  | 'ADV_TAX_COLLECTED'
  | 'SALARIES_PAYABLE'
  | 'OPENING_EQUITY'
  | 'SALES'
  | 'SALES_RETURNS'
  | 'COGS'
  | 'SALARIES_EXPENSE'
  | 'DEPRECIATION_EXPENSE'
  | 'OTHER_EXPENSES'

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'

export interface SystemAccountDef {
  key: SystemKey
  code: string
  name: string
  type: AccountType
  subType: string | null
}

export const SYSTEM_ACCOUNTS: SystemAccountDef[] = [
  { key: 'CASH', code: '1000', name: 'Cash in Hand', type: 'ASSET', subType: 'CASH' },
  { key: 'BANK', code: '1010', name: 'Bank', type: 'ASSET', subType: 'BANK' },
  { key: 'AR', code: '1100', name: 'Accounts Receivable', type: 'ASSET', subType: 'RECEIVABLE' },
  { key: 'INVENTORY', code: '1200', name: 'Inventory', type: 'ASSET', subType: 'INVENTORY' },
  { key: 'ADV_TAX_RECOVERABLE', code: '1300', name: 'Advance Tax Recoverable', type: 'ASSET', subType: 'TAX' },
  { key: 'SALES_TAX_INPUT', code: '1310', name: 'Sales Tax Input', type: 'ASSET', subType: 'TAX' },
  { key: 'FIXED_ASSETS', code: '1500', name: 'Fixed Assets', type: 'ASSET', subType: 'FIXED_ASSET' },
  { key: 'ACCUM_DEPRECIATION', code: '1510', name: 'Accumulated Depreciation', type: 'ASSET', subType: 'CONTRA' },
  { key: 'AP', code: '2000', name: 'Accounts Payable', type: 'LIABILITY', subType: 'PAYABLE' },
  { key: 'SALES_TAX_PAYABLE', code: '2100', name: 'Sales Tax Payable', type: 'LIABILITY', subType: 'TAX' },
  { key: 'ADV_TAX_COLLECTED', code: '2110', name: 'Advance Tax Collected', type: 'LIABILITY', subType: 'TAX' },
  { key: 'SALARIES_PAYABLE', code: '2200', name: 'Salaries Payable', type: 'LIABILITY', subType: 'PAYROLL' },
  { key: 'OPENING_EQUITY', code: '3000', name: 'Opening Balance Equity', type: 'EQUITY', subType: null },
  { key: 'SALES', code: '4000', name: 'Sales', type: 'INCOME', subType: null },
  { key: 'SALES_RETURNS', code: '4100', name: 'Sales Returns', type: 'INCOME', subType: 'CONTRA' },
  { key: 'COGS', code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', subType: 'COGS' },
  { key: 'SALARIES_EXPENSE', code: '5100', name: 'Salaries Expense', type: 'EXPENSE', subType: null },
  { key: 'DEPRECIATION_EXPENSE', code: '5200', name: 'Depreciation Expense', type: 'EXPENSE', subType: null },
  { key: 'OTHER_EXPENSES', code: '5900', name: 'Other Expenses', type: 'EXPENSE', subType: null },
]

// Anything with an `account` delegate (PrismaClient or a transaction client).
export type AccountDb = Pick<Prisma.TransactionClient, 'account'>

type Chart = Record<SystemKey, string>

// key -> id cache; validated against the DB on every use (one cheap count), so it is
// correct even if rows were deleted or a seeding transaction was rolled back.
let cache: Chart | null = null

/** Idempotently upserts the system accounts (by systemKey) and returns key -> account id. */
export async function ensureChart(db: AccountDb): Promise<Chart> {
  if (cache) {
    const ids = Object.values(cache)
    const found = await db.account.count({ where: { id: { in: ids } } })
    if (found === ids.length) return { ...cache }
    cache = null
  }
  const chart = {} as Chart
  for (const def of SYSTEM_ACCOUNTS) {
    const clash = await db.account.findUnique({ where: { code: def.code }, select: { systemKey: true } })
    if (clash && clash.systemKey !== def.key) {
      throw new Error(
        `Cannot seed system account "${def.name}": account code ${def.code} is already used by another account. Change that account's code first.`,
      )
    }
    const row = await db.account.upsert({
      where: { systemKey: def.key },
      update: {}, // never overwrite staff renames
      create: {
        code: def.code,
        name: def.name,
        type: def.type,
        subType: def.subType,
        systemKey: def.key,
        isSystem: true,
      },
      select: { id: true },
    })
    chart[def.key] = row.id
  }
  cache = chart
  return { ...chart }
}
