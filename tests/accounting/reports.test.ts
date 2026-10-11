import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  trialBalance, profitAndLoss, balanceSheet, taxSummary, sumLines, taxMonthSums,
  type ReportAccount, type LedgerLine,
} from '../../lib/accounting/reports'

const A = (id: string, code: string, type: ReportAccount['type'], subType: string | null = null, systemKey: string | null = null): ReportAccount =>
  ({ id, code, name: id, type, subType, systemKey })

const accounts: ReportAccount[] = [
  A('cash', '1000', 'ASSET'), A('ar', '1100', 'ASSET'), A('inv', '1200', 'ASSET'),
  A('advrec', '1300', 'ASSET', 'TAX', 'ADV_TAX_RECOVERABLE'), A('stin', '1310', 'ASSET', 'TAX', 'SALES_TAX_INPUT'),
  A('fa', '1500', 'ASSET'), A('accdep', '1510', 'ASSET', 'CONTRA'),
  A('ap', '2000', 'LIABILITY'), A('stpay', '2100', 'LIABILITY', 'TAX', 'SALES_TAX_PAYABLE'), A('advcol', '2110', 'LIABILITY', 'TAX', 'ADV_TAX_COLLECTED'),
  A('eq', '3000', 'EQUITY'),
  A('sales', '4000', 'INCOME'), A('ret', '4100', 'INCOME', 'CONTRA'),
  A('cogs', '5000', 'EXPENSE', 'COGS'), A('rent', '5900', 'EXPENSE'), A('depx', '5200', 'EXPENSE'),
  A('unused', '5999', 'EXPENSE'),
]

let n = 0
const entry = (date: string, ...pairs: [string, number, number][]): LedgerLine[] => {
  n++
  return pairs.map(([accountId, debit, credit]) => ({ accountId, date, debit, credit }))
}

// Hand-built ledger (paisa). Opening equity 100000.00; one sale of 10000 + 1700 tax, return 1000, COGS 6000, rent 500,
// purchase with input tax, asset + depreciation.
const ledger: LedgerLine[] = [
  ...entry('2026-09-01', ['cash', 10000000, 0], ['eq', 0, 10000000]),
  ...entry('2026-09-10', ['ar', 1170000, 0], ['sales', 0, 1000000], ['stpay', 0, 170000]),
  ...entry('2026-09-10', ['cogs', 600000, 0], ['inv', 0, 600000]),
  ...entry('2026-09-15', ['ret', 100000, 0], ['ar', 0, 100000]),
  ...entry('2026-09-20', ['cash', 500000, 0], ['ar', 0, 500000]),
  ...entry('2026-10-02', ['rent', 50000, 0], ['cash', 0, 50000]),
  ...entry('2026-10-03', ['inv', 800000, 0], ['stin', 136000, 0], ['advrec', 8000, 0], ['ap', 0, 944000]),
  ...entry('2026-10-04', ['fa', 1200000, 0], ['cash', 0, 1200000]),
  ...entry('2026-10-31', ['depx', 100000, 0], ['accdep', 0, 100000]),
  ...entry('2026-10-12', ['ar', 11, 0], ['advcol', 0, 11]),
]

test('trial balance ties and flags imbalance', () => {
  const tb = trialBalance(accounts, sumLines(ledger))
  assert.equal(tb.balanced, true)
  assert.equal(tb.totalDebit, tb.totalCredit)
  assert.ok(!tb.rows.some((r) => r.accountId === 'unused'))
  assert.ok(trialBalance(accounts, sumLines(ledger), { includeZero: true }).rows.some((r) => r.accountId === 'unused'))
  const bad = trialBalance(accounts, [...sumLines(ledger), { accountId: 'cash', debit: 1, credit: 0 }])
  assert.equal(bad.balanced, false)
  assert.equal(bad.difference, 0.01)
})

test('trial balance as-of excludes later lines', () => {
  const tb = trialBalance(accounts, sumLines(ledger, { to: '2026-09-30' }))
  assert.equal(tb.balanced, true)
  assert.ok(!tb.rows.some((r) => r.accountId === 'rent'))
})

test('P&L: net sales, gross profit, net profit', () => {
  const pl = profitAndLoss(accounts, sumLines(ledger, { from: '2026-09-01', to: '2026-10-31' }))
  assert.equal(pl.totalIncome, 10000)
  assert.equal(pl.totalSalesReturns, 1000)
  assert.equal(pl.salesReturns[0].amount, 1000) // positive deduction
  assert.equal(pl.netSales, 9000)
  assert.equal(pl.totalCogs, 6000)
  assert.equal(pl.grossProfit, 3000)
  assert.equal(pl.totalExpenses, 1500) // rent 500 + depreciation 1000
  assert.deepEqual(pl.expenses.map((e) => e.name), ['depx', 'rent'])
  assert.equal(pl.netProfit, 1500)
})

test('P&L range excludes outside lines', () => {
  const pl = profitAndLoss(accounts, sumLines(ledger, { from: '2026-10-01', to: '2026-10-31' }))
  assert.equal(pl.totalIncome, 0)
  assert.equal(pl.netProfit, -1500)
  assert.equal(profitAndLoss(accounts, []).netProfit, 0)
})

test('balance sheet: contra asset negative, retained earnings, balances', () => {
  const bs = balanceSheet(accounts, sumLines(ledger, { to: '2026-10-31' }))
  assert.equal(bs.assets.find((r) => r.accountId === 'accdep')!.amount, -1000)
  assert.equal(bs.retainedEarnings, 1500)
  assert.equal(bs.totalEquity, 100000 + 1500)
  assert.equal(bs.balanced, true)
  assert.equal(bs.totalAssets, bs.totalLiabilitiesAndEquity)
  // as of mid-September: only the sale/return/payment exist
  const mid = balanceSheet(accounts, sumLines(ledger, { to: '2026-09-30' }))
  assert.equal(mid.balanced, true)
  assert.equal(mid.retainedEarnings, 3000)
})

test('tax summary per month', () => {
  const ts = taxSummary(taxMonthSums(accounts, ledger))
  assert.deepEqual(ts.months.map((m) => m.month), ['2026-09', '2026-10'])
  assert.equal(ts.months[0].salesTaxCollected, 1700)
  assert.equal(ts.months[0].netSalesTax, 1700)
  assert.equal(ts.months[1].salesTaxInput, 1360)
  assert.equal(ts.months[1].netSalesTax, -1360)
  assert.equal(ts.months[1].advTaxRecoverable, 80)
  assert.equal(ts.months[1].advTaxCollected, 0.11)
  assert.equal(ts.totals.netSalesTax, 340)
  assert.equal(ts.totals.advTaxCollected, 0.11)
  assert.equal(taxSummary([]).months.length, 0)
})

// Seeded PRNG property test: random balanced entries always tie.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('property: random balanced ledgers -> TB debits = credits, balance sheet balances, P&L = retained earnings', () => {
  for (const seed of [1, 2, 3, 42, 99, 12345, 777, 2026]) {
    const r = rng(seed)
    const lines: LedgerLine[] = []
    const count = 20 + Math.floor(r() * 60)
    for (let i = 0; i < count; i++) {
      const date = `2026-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`
      const k = 2 + Math.floor(r() * 3) // 2-4 lines
      const amts: number[] = []
      let total = 0
      for (let j = 0; j < k - 1; j++) { const a = 1 + Math.floor(r() * 500000); amts.push(a); total += a }
      const ids = accounts.map((a) => a.id)
      const pick = () => ids[Math.floor(r() * ids.length)]
      const debitSide = r() < 0.5
      // k-1 lines on one side, one balancing line on the other
      for (const a of amts) lines.push({ accountId: pick(), date, debit: debitSide ? a : 0, credit: debitSide ? 0 : a })
      lines.push({ accountId: pick(), date, debit: debitSide ? 0 : total, credit: debitSide ? total : 0 })
    }
    const sums = sumLines(lines)
    const tb = trialBalance(accounts, sums, { includeZero: true })
    assert.equal(tb.balanced, true, `seed ${seed} TB`)
    const bs = balanceSheet(accounts, sums, { includeZero: true })
    assert.equal(bs.balanced, true, `seed ${seed} BS`)
    const pl = profitAndLoss(accounts, sums)
    assert.equal(Math.round(pl.netProfit * 100), Math.round(bs.retainedEarnings * 100), `seed ${seed} P&L`)
  }
})
