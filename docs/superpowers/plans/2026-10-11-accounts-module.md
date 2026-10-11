# Accounts Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Double-entry accounting (GL, AR, AP, Cash & Bank, Fixed Assets, Payroll, Tax, Financial Reporting) driven by an idempotent sync engine, inert until a go-live date is set.

**Architecture:** Pure posting builders turn a source record into balanced journal lines; `syncSource(type,id)` deletes and recreates that source's auto entries in one transaction; business routes call `syncSafe` after success. Manual features (journals, transfers, assets, payroll) post entries with their own sourceType.

**Tech Stack:** Next.js 14 App Router, Prisma 7 (`@prisma/adapter-pg`), Supabase Postgres (PRODUCTION, no staging), node:test via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-accounts-module-design.md` (binding). Read `../CLAUDE.md` "Tax & Pricing Model" and "Development & Deployment Reality" first.

## Global Constraints
- Production DB: additive schema only; run row counts before `db push`; QA-prefixed test records (names start `QA `) removed in `finally`; never `git push`; never leave a dev server running (one at a time, port 3100); no git commits by subagents (controller commits).
- Money is `Decimal(12,2)`; convert with `Number()`/round2 at line level; every entry must satisfy Σdebit = Σcredit exactly (compare in integer paisa).
- All `/api/accounts/*` routes: ADMIN or ACCOUNTANT only via `getUserFromRequest(req)` (`lib/utils/auth.ts`), 403 otherwise. Reports P&L API: ADMIN/MANAGER/ACCOUNTANT.
- Nothing posts before `AccountingSettings.goLiveDate` is set; sources dated before it are ignored; `lockedThrough` blocks posting/edit/delete at or before that date.
- UI: match existing pages (Card, Button, Input, Select with `items`, formatPKR, DateRangePicker, toasts via sonner). Dates Asia/Karachi. Nav already contains the tabs (`lib/nav.ts`); replace the `ComingSoon` stubs in `app/(erp)/accounts/*`, `settings/chart-of-accounts`, `reports/profit-loss`.
- Existing business behaviour must not change; `syncSafe` swallows and logs errors.

## Review Focus
- Editing/deleting an invoice, purchase invoice, payment or return must leave the ledger matching the source (sync after the mutation, incl. the approvals executor and hard deletes).
- Running sync twice must not duplicate entries; concurrent syncs for the same source must serialise (advisory lock per source key).
- Orders delivered with null `unitCost` / zero tax / bonus-only purchase lines must still balance.
- A MANAGER/WAREHOUSE/SALES_REP session must get 403 on every `/api/accounts/*` route.
- Locked period: manual journal and sync both refuse/skip, with a visible report.

---

### Task 1: Schema, chart seed, accounting core
**Files:** Modify `prisma/schema.prisma`; Create `lib/accounting/{accounts.ts,core.ts,money.ts}`, `lib/accounting/guard.ts`, `tests/accounting/core.test.ts`.
**Interfaces — Produces:**
- Models exactly per spec: `Account`, `JournalEntry`, `JournalLine`, `AccountingSettings`, `FixedAsset`, `PayrollRun`, `PayrollLine`, and `OrderItem.unitCost Decimal? @db.Decimal(10,2)`. Relations: JournalLine→Account/JournalEntry; optional `retailerId/supplierId/employeeId` plain String columns (no FK needed) with indexes `[retailerId]`,`[supplierId]`,`[accountId]`,`[entryId]`; `JournalEntry @@index([sourceType, sourceId])`, `@@index([date])`.
- `SYSTEM_ACCOUNTS`: array of `{key, code, name, type, subType}` and type `SystemKey` = `'CASH'|'BANK'|'AR'|'INVENTORY'|'ADV_TAX_RECOVERABLE'|'SALES_TAX_INPUT'|'FIXED_ASSETS'|'ACCUM_DEPRECIATION'|'AP'|'SALES_TAX_PAYABLE'|'ADV_TAX_COLLECTED'|'SALARIES_PAYABLE'|'OPENING_EQUITY'|'SALES'|'SALES_RETURNS'|'COGS'|'SALARIES_EXPENSE'|'DEPRECIATION_EXPENSE'|'OTHER_EXPENSES'`; codes 1000-series assets, 2000 liabilities, 3000 equity, 4000 income, 5000 expenses.
- `ensureChart(db): Promise<Record<SystemKey,string>>` idempotent upsert by systemKey → account ids.
- `money.ts`: `toPaisa(n)`, `fromPaisa(p)`, `round2(n)`.
- `core.ts`: `type LineInput = {accountKey?: SystemKey; accountId?: string; debit?: number; credit?: number; memo?: string; retailerId?: string; supplierId?: string; employeeId?: string}`; `assertBalanced(lines)` (throws unless Σ paisa equal and total > 0, no negative amounts, each line has exactly one of debit/credit > 0); `getSettings(db)` (creates the single row if absent); `assertNotLocked(settings, date)`; `postEntry(tx, {date, memo, sourceType?, sourceId?, isManual, createdById?, reversesId?, lines})` → creates entry + lines, resolves accountKey via `ensureChart`, generates `SP-JV-YYYYMMDD-XXXX` (retry on unique collision); `guard.ts`: `requireAccountsUser(req)` → `{user}` or a `NextResponse` 403/401 to return.
- [ ] Row counts (`pg`) of tables you will touch are irrelevant (all new) — instead confirm the `OrderItem` row count and that only ADD COLUMN/CREATE TABLE appear in `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` before `npx prisma db push` (use `--accept-data-loss` only if the diff shows no drops).
- [ ] Unit tests: `assertBalanced` (balanced ok; off by 0.01 throws; zero/negative/both-sided line throws; float noise like 0.1+0.2 passes), `toPaisa` rounding, `ensureChart` is not unit-tested (integration in Task 3).
- [ ] `npx prisma generate`, `npx tsc --noEmit`, `npx tsx --test tests/accounting/*.test.ts`.

### Task 2: Posting builders (pure) + unitCost capture
**Files:** Create `lib/accounting/builders.ts`, `tests/accounting/builders.test.ts`; Modify `app/api/orders/[id]/status/route.ts` (and any other place that deducts stock on DELIVERED — `grep -rn "DELIVERED" app/api` and cover each, e.g. deliveries route).
**Interfaces — Produces:** pure functions each returning `{date: Date; memo: string; lines: LineInput[]}[]` (empty array = nothing to post): `buildInvoice(inv)`, `buildDeliveryCogs(order)`, `buildCustomerPayment(p)`, `buildSalesReturn(r)`, `buildPurchaseInvoice(pi)`, `buildSupplierPayment(p)`, `buildSupplierReturn(r)`. Input shapes are plain objects with Numbers (not Prisma Decimal) defined and exported in the same file. Mapping exactly per the spec table; method CASH → `CASH` else `BANK`. Zero-amount lines are omitted; if all lines vanish return `[]`.
- Delivered stock deduction: record per-item weighted cost = Σ(deducted qty × batch.purchasePrice)/qty and `tx.orderItem.update({data:{unitCost}})`. Behaviour otherwise unchanged. If medicine has no batches, leave null.
- [ ] Tests (write first): invoice with tax; invoice zero tax; purchase invoice with ST + both AIT and bonus (totals tie to `totalAmount`); payment CASH vs BANK_TRANSFER; sales return restocked vs not (restocked adds Dr Inventory/Cr COGS at batch purchase price); null unitCost → no COGS entry; every builder output passes `assertBalanced`.

### Task 3: Sync engine, hooks, rebuild, accounts APIs
**Files:** Create `lib/accounting/sync.ts`, `app/api/accounts/{settings,accounts,journals,ledger,rebuild}/…/route.ts` (accounts GET/POST, `[id]` PUT; journals GET list+filters, POST manual, `[id]/reverse` POST; `ledger/[accountId]` GET with from/to and running balance; settings GET/PUT; rebuild POST), `tests/accounting/qa-sync.ts`.
Modify the mutation routes: `orders/[id]/status`, `orders/[id]` (PUT, DELETE), `approvals/[id]`, `invoices/[id]` (+ `payments`), `purchase-invoices` (POST), `purchase-invoices/[id]` (PUT, + `payments`), `sales-returns`, `suppliers/[id]/returns`, and any other route that touches Invoice/Payment/SupplierPayment/returns (grep).
**Interfaces — Produces:** `type SourceType = 'INVOICE'|'DELIVERY_COGS'|'PAYMENT'|'SALES_RETURN'|'PURCHASE_INVOICE'|'SUPPLIER_PAYMENT'|'SUPPLIER_RETURN'`; `syncSource(type, id): Promise<{status:'posted'|'removed'|'skipped'; reason?: string}>` — takes `pg_advisory_xact_lock(hashtext(type||':'||id))`, loads the record, deletes existing auto entries for (type,id), builds, `assertNotLocked`, posts; no-op `skipped` when no `goLiveDate`, record dated before it, or locked. `syncSafe(type, id)` never throws (console.error). Order status change syncs `INVOICE` (order's invoice id) and `DELIVERY_COGS` (order id); order/invoice delete syncs removal for the ids captured before deletion. `rebuildAll()` iterates all sources since go-live and returns counts + skipped list.
- Manual journals: `isManual=true`, ADMIN/ACCOUNTANT, `assertNotLocked`, reverse creates a mirrored entry (`reversesId`), refuse to reverse twice or reverse auto entries (auto entries follow their source).
- [ ] QA script (production, QA records, cleanup in `finally`): with a QA retailer/medicine/batch, set goLiveDate = today, create order→confirm→deliver→pay→return→delete and assert after each step that ledger totals match the source (AR balance for party; COGS), sync twice = identical, concurrent syncs (parallel 6) = one entry set, locked period skip. **Restore `AccountingSettings` (goLiveDate/lockedThrough null) and delete QA entries afterwards.**
- [ ] 403 test for MANAGER/SALES_REP/no-cookie on every new route.

### Task 4: Chart of Accounts + General Ledgers + Accounts settings UI
**Files:** `app/(erp)/settings/chart-of-accounts/page.tsx`, `app/(erp)/accounts/general-ledger/page.tsx`, `app/(erp)/accounts/page.tsx` (redirect to general-ledger if it is a stub), components under `components/accounts/`.
- Chart: tree/list grouped by type, add/rename/deactivate (system rows lock type/code, show badge); settings card (go-live date, locked-through, default bank, Rebuild ledger button with result toast/list).
- GL: account selector → ledger with date range, running balance, source link (invoice/purchase invoice page by sourceType); manual journal dialog (balanced lines, optional party selects), reverse button on manual entries; CSV export.
- [ ] Verify by `tsc`, build, and an HTTP check of page status with a signed cookie (like `tests/portal/qa-pages.ts`); describe untested visuals honestly.

### Task 5: Accounts Receivable + Accounts Payable
**Files:** `app/api/accounts/{receivable,payable}/route.ts` (+ `[partyId]` statement routes), pages `accounts/receivable`, `accounts/payable`, `components/accounts/PartyBalances.tsx`.
- List parties with ledger balance (AR lines grouped by retailerId; AP by supplierId), search, only non-zero toggle, totals; party statement (entries, running balance); **reconciliation**: ledger balance vs existing invoice-derived outstanding (see `app/api/retailers/[id]/route.ts` and `computeSupplierOutstanding`) with differing parties listed; "Add opening balance" form (manual entry Dr AR/Cr OPENING_EQUITY, or Dr OPENING_EQUITY/Cr AP, dated go-live date, with party).
- [ ] QA: opening balance + invoice → statement running balance; reconciliation difference equals the opening balance only.

### Task 6: Cash & Bank
**Files:** `app/api/accounts/cash-bank/{route.ts,transfer,expense,receipt}`, page `accounts/cash-bank`.
- List CASH/BANK subType accounts (any account whose subType is CASH or BANK) with balances; add bank account (creates Account subType BANK); transfer (Dr to, Cr from); expense/payment (Dr chosen expense/any account, Cr cash/bank); other receipt (Dr cash/bank, Cr chosen account). All manual entries with sourceType `MANUAL_CASH` and lock check; default bank for auto postings comes from settings (extend `postEntry`/builders: BANK key resolves to `defaultBankAccountId` when set).
- [ ] QA: transfer keeps total cash+bank constant; expense reduces cash; balances in list = GL ledger.

### Task 7: Fixed Assets
**Files:** `app/api/accounts/fixed-assets/…`, page `accounts/fixed-assets`, `lib/accounting/depreciation.ts`, tests.
- Add asset (Dr FIXED_ASSETS Cr chosen cash/bank/AP account, source `ASSET_PURCHASE`), register with cost, accumulated, book value; `monthlyDepreciation(asset)=(cost−salvage)/life` capped so book value never < salvage; "Run depreciation for month" idempotent per (asset, month) via sourceType `DEPRECIATION` sourceId `${assetId}:${YYYY-MM}`; dispose: removes remaining book value to OTHER_EXPENSES (Dr ACCUM_DEPRECIATION, Dr OTHER_EXPENSES, Cr FIXED_ASSETS), status DISPOSED, no further depreciation.
- [ ] Unit tests: depreciation math incl. final-month cap, salvage ≥ cost → 0; QA: run month twice = single entry.

### Task 8: Payroll
**Files:** `app/api/accounts/payroll/…`, page `accounts/payroll`, `lib/accounting/payroll.ts`, tests.
- `computeDeduction(salary, absentDays, halfDays)=round2(salary/30*(absent+0.5*half))` (never > salary); create run for `YYYY-MM` from active employees with a salary (not DRIVER-excluded — include all with salary), absences from Attendance for that month; editable deduction/bonus per DRAFT line; Post → Dr SALARIES_EXPENSE Cr SALARIES_PAYABLE (`PAYROLL`, sourceId runId; employeeId on lines); Mark paid → Dr SALARIES_PAYABLE Cr cash/bank (`PAYROLL_PAYMENT`); Re-open removes entries (blocked if paid or locked).
- [ ] Unit tests for deduction; QA: run for a QA employee, post, pay, re-open blocked after pay; month uniqueness.

### Task 9: Tax Management + Financial Reporting + P&L
**Files:** `app/api/accounts/tax/route.ts`, `app/api/accounts/reports/{trial-balance,profit-loss,balance-sheet}/route.ts`, `app/api/reports/profit-loss/route.ts` (thin wrapper, ADMIN/MANAGER/ACCOUNTANT), pages `accounts/tax`, `accounts/financial-reporting`, `reports/profit-loss`, `lib/accounting/reports.ts` (pure aggregation + tests).
- Trial balance as-of (debits = credits shown, flagged if not); P&L for a range (Income − Sales Returns − COGS − Expenses; gross profit, net profit); Balance Sheet as-of (Assets = Liabilities + Equity + current-period net profit; check row); Tax: per month Sales tax collected (SALES_TAX_PAYABLE credits) vs input (SALES_TAX_INPUT debits) → net payable; ADV_TAX_COLLECTED vs ADV_TAX_RECOVERABLE; CSV export for each.
- [ ] Unit tests for aggregation with a hand-built ledger; QA: after Task 3's scenario the balance sheet balances.

### Task 10: Docs and end-to-end
- Update `../CLAUDE.md` (Phase 14: Accounts; not-yet-done list) and memory note `auth_system.md` is untouched unless auth changed; final run of every QA script, `tsc`, unit tests, `npm run build`; confirm zero QA residue and `AccountingSettings` left with goLiveDate null.
