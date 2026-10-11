// Pure financial-report aggregation. No DB access: callers feed per-account debit/credit sums
// (integer paisa) that were summed in the database. All totals/tie-outs are computed in paisa.
import { fromPaisa } from './money'

export type ReportAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'

export interface ReportAccount {
  id: string
  code: string
  name: string
  type: ReportAccountType
  subType: string | null
  systemKey?: string | null
}

/** Sum of debits/credits (integer paisa) posted to one account in the window being reported. */
export interface AccountSum {
  accountId: string
  debit: number
  credit: number
}

/** A hand-built / loaded ledger line (paisa). `date` is a Karachi calendar day, YYYY-MM-DD. */
export interface LedgerLine {
  accountId: string
  date: string
  debit: number
  credit: number
}

export interface ReportOptions {
  includeZero?: boolean
}

const debitNormal = (t: ReportAccountType) => t === 'ASSET' || t === 'EXPENSE'
const isContra = (a: ReportAccount) => a.subType === 'CONTRA'

/** Sums lines per account for from <= date <= to (both optional, inclusive Karachi days). */
export function sumLines(lines: LedgerLine[], range: { from?: string; to?: string } = {}): AccountSum[] {
  const m = new Map<string, AccountSum>()
  for (const l of lines) {
    if (range.from && l.date < range.from) continue
    if (range.to && l.date > range.to) continue
    const s = m.get(l.accountId) ?? { accountId: l.accountId, debit: 0, credit: 0 }
    s.debit += l.debit
    s.credit += l.credit
    m.set(l.accountId, s)
  }
  return Array.from(m.values())
}

function sumMap(sums: AccountSum[]) {
  const m = new Map<string, { debit: number; credit: number }>()
  for (const s of sums) {
    const c = m.get(s.accountId) ?? { debit: 0, credit: 0 }
    c.debit += s.debit
    c.credit += s.credit
    m.set(s.accountId, c)
  }
  return m
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true })

/** Signed balance in the account's normal direction (paisa). */
function normalBalance(a: ReportAccount, s: { debit: number; credit: number } | undefined): number {
  if (!s) return 0
  return debitNormal(a.type) ? s.debit - s.credit : s.credit - s.debit
}

// ---------------- Trial balance ----------------

export interface TrialBalanceRow {
  accountId: string
  code: string
  name: string
  type: ReportAccountType
  debit: number
  credit: number
}
export interface TrialBalance {
  rows: TrialBalanceRow[]
  totalDebit: number
  totalCredit: number
  difference: number
  balanced: boolean
}

export function trialBalance(accounts: ReportAccount[], sums: AccountSum[], opts: ReportOptions = {}): TrialBalance {
  const m = sumMap(sums)
  const rows: TrialBalanceRow[] = []
  let td = 0
  let tc = 0
  for (const a of [...accounts].sort(byCode)) {
    const s = m.get(a.id)
    const net = (s?.debit ?? 0) - (s?.credit ?? 0) // + = debit balance
    const d = net > 0 ? net : 0
    const c = net < 0 ? -net : 0
    td += d
    tc += c
    if (net === 0 && !opts.includeZero) continue
    rows.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, debit: fromPaisa(d), credit: fromPaisa(c) })
  }
  return { rows, totalDebit: fromPaisa(td), totalCredit: fromPaisa(tc), difference: fromPaisa(td - tc), balanced: td === tc }
}

// ---------------- Profit & Loss ----------------

export interface ReportRow {
  accountId: string
  code: string
  name: string
  amount: number
}
export interface ProfitAndLoss {
  income: ReportRow[] // non-contra income accounts (credit-normal)
  totalIncome: number
  salesReturns: ReportRow[] // contra income, shown as positive deductions
  totalSalesReturns: number
  netSales: number
  cogs: ReportRow[]
  totalCogs: number
  grossProfit: number
  expenses: ReportRow[]
  totalExpenses: number
  netProfit: number
}

export function profitAndLoss(accounts: ReportAccount[], sums: AccountSum[], opts: ReportOptions = {}): ProfitAndLoss {
  const m = sumMap(sums)
  const income: ReportRow[] = []
  const returns: ReportRow[] = []
  const cogs: ReportRow[] = []
  const expenses: ReportRow[] = []
  let ti = 0, tr = 0, tcg = 0, te = 0
  for (const a of [...accounts].sort(byCode)) {
    if (a.type !== 'INCOME' && a.type !== 'EXPENSE') continue
    const bal = normalBalance(a, m.get(a.id)) // income: credit - debit; expense: debit - credit
    const keep = bal !== 0 || opts.includeZero
    if (a.type === 'INCOME') {
      if (isContra(a)) {
        // contra-income's natural balance is a debit, i.e. negative here: a positive deduction
        tr += -bal
        if (keep) returns.push({ accountId: a.id, code: a.code, name: a.name, amount: fromPaisa(-bal) })
      } else {
        ti += bal
        if (keep) income.push({ accountId: a.id, code: a.code, name: a.name, amount: fromPaisa(bal) })
      }
    } else if (a.subType === 'COGS') {
      tcg += bal
      if (keep) cogs.push({ accountId: a.id, code: a.code, name: a.name, amount: fromPaisa(bal) })
    } else {
      te += bal
      if (keep) expenses.push({ accountId: a.id, code: a.code, name: a.name, amount: fromPaisa(bal) })
    }
  }
  const net = ti - tr
  return {
    income, totalIncome: fromPaisa(ti),
    salesReturns: returns, totalSalesReturns: fromPaisa(tr),
    netSales: fromPaisa(net),
    cogs, totalCogs: fromPaisa(tcg),
    grossProfit: fromPaisa(net - tcg),
    expenses, totalExpenses: fromPaisa(te),
    netProfit: fromPaisa(net - tcg - te),
  }
}

// ---------------- Balance sheet ----------------

export interface BalanceSheet {
  assets: ReportRow[] // contra-assets (accumulated depreciation) appear as negatives
  totalAssets: number
  liabilities: ReportRow[]
  totalLiabilities: number
  equity: ReportRow[] // includes the synthetic retained-earnings row (accountId 'retained-earnings')
  retainedEarnings: number // cumulative net profit up to asOf
  totalEquity: number // equity accounts + retained earnings
  totalLiabilitiesAndEquity: number
  difference: number
  balanced: boolean
}

/** `sums` must cover the whole ledger up to the as-of day (go-live onwards). */
export function balanceSheet(accounts: ReportAccount[], sums: AccountSum[], opts: ReportOptions = {}): BalanceSheet {
  const m = sumMap(sums)
  const assets: ReportRow[] = []
  const liabilities: ReportRow[] = []
  const equity: ReportRow[] = []
  let ta = 0, tl = 0, te = 0, earnings = 0
  for (const a of [...accounts].sort(byCode)) {
    const bal = normalBalance(a, m.get(a.id))
    const keep = bal !== 0 || opts.includeZero
    const row = { accountId: a.id, code: a.code, name: a.name, amount: fromPaisa(bal) }
    if (a.type === 'ASSET') { ta += bal; if (keep) assets.push(row) }
    else if (a.type === 'LIABILITY') { tl += bal; if (keep) liabilities.push(row) }
    else if (a.type === 'EQUITY') { te += bal; if (keep) equity.push(row) }
    else if (a.type === 'INCOME') earnings += bal
    else earnings -= bal
  }
  if (earnings !== 0 || opts.includeZero) {
    equity.push({ accountId: 'retained-earnings', code: '', name: 'Retained earnings (cumulative net profit)', amount: fromPaisa(earnings) })
  }
  const totalEquity = te + earnings
  const diff = ta - (tl + totalEquity)
  return {
    assets, totalAssets: fromPaisa(ta),
    liabilities, totalLiabilities: fromPaisa(tl),
    equity, retainedEarnings: fromPaisa(earnings), totalEquity: fromPaisa(totalEquity),
    totalLiabilitiesAndEquity: fromPaisa(tl + totalEquity),
    difference: fromPaisa(diff), balanced: diff === 0,
  }
}

// ---------------- Tax summary ----------------

export const TAX_KEYS = ['SALES_TAX_PAYABLE', 'SALES_TAX_INPUT', 'ADV_TAX_COLLECTED', 'ADV_TAX_RECOVERABLE'] as const
export type TaxKey = (typeof TAX_KEYS)[number]

/** Debit/credit paisa posted to a tax account in one Karachi month (YYYY-MM). */
export interface TaxMonthSum {
  month: string
  key: string
  debit: number
  credit: number
}
export interface TaxMonthRow {
  month: string
  salesTaxCollected: number
  salesTaxInput: number
  netSalesTax: number // collected - input (payable when positive)
  advTaxCollected: number
  advTaxRecoverable: number
  netAdvTax: number // collected - recoverable
}
export interface TaxSummary {
  months: TaxMonthRow[]
  totals: Omit<TaxMonthRow, 'month'>
}

export function taxSummary(sums: TaxMonthSum[]): TaxSummary {
  const by = new Map<string, { sc: number; si: number; ac: number; ar: number }>()
  for (const s of sums) {
    const r = by.get(s.month) ?? { sc: 0, si: 0, ac: 0, ar: 0 }
    if (s.key === 'SALES_TAX_PAYABLE') r.sc += s.credit
    else if (s.key === 'SALES_TAX_INPUT') r.si += s.debit
    else if (s.key === 'ADV_TAX_COLLECTED') r.ac += s.credit
    else if (s.key === 'ADV_TAX_RECOVERABLE') r.ar += s.debit
    by.set(s.month, r)
  }
  const t = { sc: 0, si: 0, ac: 0, ar: 0 }
  const months = Array.from(by.keys()).sort().map((month) => {
    const r = by.get(month)!
    t.sc += r.sc; t.si += r.si; t.ac += r.ac; t.ar += r.ar
    return {
      month,
      salesTaxCollected: fromPaisa(r.sc), salesTaxInput: fromPaisa(r.si), netSalesTax: fromPaisa(r.sc - r.si),
      advTaxCollected: fromPaisa(r.ac), advTaxRecoverable: fromPaisa(r.ar), netAdvTax: fromPaisa(r.ac - r.ar),
    }
  })
  return {
    months,
    totals: {
      salesTaxCollected: fromPaisa(t.sc), salesTaxInput: fromPaisa(t.si), netSalesTax: fromPaisa(t.sc - t.si),
      advTaxCollected: fromPaisa(t.ac), advTaxRecoverable: fromPaisa(t.ar), netAdvTax: fromPaisa(t.ac - t.ar),
    },
  }
}

/** Test helper: month sums for the tax accounts from raw lines (mirrors the SQL used by the API). */
export function taxMonthSums(accounts: ReportAccount[], lines: LedgerLine[], range: { from?: string; to?: string } = {}): TaxMonthSum[] {
  const keyOf = new Map(accounts.map((a) => [a.id, a.systemKey ?? '']))
  const m = new Map<string, TaxMonthSum>()
  for (const l of lines) {
    const key = keyOf.get(l.accountId) ?? ''
    if (!(TAX_KEYS as readonly string[]).includes(key)) continue
    if (range.from && l.date < range.from) continue
    if (range.to && l.date > range.to) continue
    const month = l.date.slice(0, 7)
    const k = `${month}|${key}`
    const s = m.get(k) ?? { month, key, debit: 0, credit: 0 }
    s.debit += l.debit
    s.credit += l.credit
    m.set(k, s)
  }
  return Array.from(m.values())
}
