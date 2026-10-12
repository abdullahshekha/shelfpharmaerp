# Accounts Module — Design Spec

Date: 2026-10-11 · Status: written for review · Phase 6 of the ShelfPharma change request (item 2, "Accounts")

## Decisions already made with the owner
- Real **double-entry General Ledger** (not report-only sub-ledgers).
- **Opening balances at a go-live date**; no backfill of old records.
- Tabs in this phase: General Ledgers, Accounts Receivable, Accounts Payable, Cash & Bank, Fixed Assets, Payroll, Tax Management, Financial Reporting, plus Settings > Chart of Accounts and Reports > P&L.

## Core idea: an idempotent "sync" posting engine
Sales, purchases, payments and returns already exist and are edited/deleted in many routes (orders status/PUT/DELETE, approvals executor, purchase invoices POST/PUT, payments, returns). Hooking a journal post into every mutation is fragile. Instead:

- `lib/accounting/sync.ts` exposes `syncSource(sourceType, sourceId)`: inside one transaction it **deletes the auto journal entry/entries for that source and recreates them from the record's current state** (a missing record → entries removed). It is idempotent, so calling it twice is harmless.
- Mutation routes call `syncSource` after they succeed (best-effort wrapper `syncSafe`: a ledger failure is logged and never fails the business operation; a **"Rebuild ledger"** button in Accounts Settings re-syncs every source since go-live and shows what changed).
- Sources and postings (amounts from existing stored fields; account names are system accounts, see below):
  | Source | Condition | Entry |
  |---|---|---|
  | `INVOICE` (sales invoice) | exists, date ≥ go-live | Dr Accounts Receivable [party=customer] `totalAmount`; Cr Sales `subtotal − discountAmount`; Cr Sales Tax Payable `taxAmount` |
  | `DELIVERY_COGS` | order DELIVERED | Dr Cost of Goods Sold, Cr Inventory = Σ qty × `OrderItem.unitCost` |
  | `PAYMENT` (customer) | date ≥ go-live | Dr Cash in Hand (method CASH) or Bank (others), Cr Accounts Receivable [party] |
  | `SALES_RETURN` | date ≥ go-live | Dr Sales Returns, Cr Accounts Receivable [party]; for restocked lines also Dr Inventory, Cr COGS at the batch purchase price |
  | `PURCHASE_INVOICE` | date ≥ go-live | Dr Inventory Σ`lineTotal`; Dr Sales Tax Input Σ`salesTaxAmount`; Dr Advance Tax Recoverable Σ`aitPayableAmount`; Cr Advance Tax Collected Σ`aitCollectibleAmount`; Cr Accounts Payable [party] `totalAmount` |
  | `SUPPLIER_PAYMENT` | date ≥ go-live | Dr Accounts Payable [party], Cr Cash/Bank |
  | `SUPPLIER_RETURN` | date ≥ go-live | Dr Accounts Payable [party], Cr Inventory `totalAmount` |
  | `PAYROLL`, `DEPRECIATION`, `ASSET_PURCHASE` | see below | see below |
  | `BATCH_WRITEOFF` (added later; not a sync source, never touched by sync/rebuild) | stock batch deleted while live (now ≥ go-live, not locked; locked → delete refused 409) | Dr Other Expenses, Cr Inventory = batch `currentQty × purchasePrice`, dated at deletion, sourceId = batch id, same transaction as the delete |
- `OrderItem.unitCost Decimal?` (additive, nullable) is **set when an order goes DELIVERED** from the FEFO batches actually deducted (weighted by quantity). COGS needs it because OrderItem has no batch link. Orders delivered before this ships have null → treated as no COGS entry (they predate go-live anyway).
- Purchase tax line mapping follows the existing Purchase Invoice formula (`totalAmount = Σ line + Σ ST − Σ AIT collectible + Σ AIT payable`); the entry always balances by construction. **The accountant should review this mapping once** (it is the one non-obvious bit); the tax mapping is changeable in one file.

## Schema (additive only)
- `Account { id, code unique, name, type ASSET|LIABILITY|EQUITY|INCOME|EXPENSE, subType String?, parentId?, systemKey String? unique, isActive, isSystem }` — seeded standard chart with 15 system accounts (Cash in Hand, Bank, AR, Inventory, Advance Tax Recoverable, Sales Tax Input, Fixed Assets, Accumulated Depreciation, AP, Sales Tax Payable, Advance Tax Collected, Salaries Payable, Owner's Equity/Opening Balance Equity, Sales, Sales Returns, COGS, Salaries Expense, Depreciation Expense, Other Expenses). System accounts cannot be deleted/retyped; staff can add accounts and rename non-system ones.
- `JournalEntry { id, entryNumber unique SP-JV-YYYYMMDD-XXXX, date, memo, sourceType?, sourceId?, isManual, createdById?, reversesId?, createdAt }`, `@@index([sourceType, sourceId])`.
- `JournalLine { id, entryId (cascade), accountId, debit Decimal(12,2), credit Decimal(12,2), memo?, retailerId?, supplierId?, employeeId? }` — a party id on AR/AP lines is what gives per-customer/supplier balances from the ledger. Each entry must balance (Σ debit = Σ credit, enforced in one place: `postEntry()`).
- `AccountingSettings` (single row): `goLiveDate`, `lockedThrough` (no posting/edit/delete at or before this date), `defaultBankAccountId`.
- `FixedAsset { id, name, category, purchaseDate, cost, salvageValue, usefulLifeMonths, status ACTIVE|DISPOSED, paidFromAccountId, accumulated (derived from entries, not stored) }`.
- `PayrollRun { id, month "YYYY-MM" unique, status DRAFT|POSTED|PAID }`, `PayrollLine { runId, employeeId, baseSalary, absentDays, halfDays, deduction, bonus, netPay }`.
- Nothing existing is altered except `OrderItem.unitCost` (nullable). Row counts are checked before `db push`.

## Tabs
- **General Ledgers:** account list with balances, drill into an account (date range, running balance, entry links); manual journal entry form (balanced lines, optional party); reverse an entry; filters by date/account/source. Auto entries cannot be edited by hand (they follow their source).
- **Accounts Receivable:** per-customer balance from the ledger (party lines on AR), customer statement (invoices, payments, returns, running balance), links to existing invoice/payment screens, a **reconciliation line**: ledger AR vs the existing invoice-derived outstanding — differences listed. Opening balances entered via manual journal (Dr AR [party] / Cr Opening Balance Equity) with a convenient "Add opening balance" form.
- **Accounts Payable:** same for suppliers; links to existing supplier/purchase screens.
- **Cash & Bank:** cash and bank accounts with balances; transfer between them; record expense/other payment (Dr expense account, Cr cash/bank) and other receipt; bank account add/rename. Customer/supplier payments already post automatically (Cash method → Cash in Hand, Bank Transfer/Cheque → default bank account).
- **Fixed Assets:** register, add asset (posts Dr Fixed Assets / Cr chosen cash-bank-or-payable account), straight-line monthly depreciation "Run depreciation for month" (posts per asset, idempotent per month), dispose (writes off to Other Expenses).
- **Payroll:** create a run for a month from active employees with a salary: `deduction = salary/30 × (absent days + ½ × half days)` from Attendance (editable per line, plus bonus); **Post** (Dr Salaries Expense / Cr Salaries Payable), **Mark paid** from chosen cash/bank (Dr Salaries Payable / Cr Cash/Bank). A posted run can be re-opened (entries removed) until the month is locked.
- **Tax Management:** monthly summary from ledger accounts: sales tax collected vs input (net payable), advance tax collected vs recoverable; period filter; CSV. Recording a tax payment = a manual journal.
- **Financial Reporting:** Trial Balance, Profit & Loss, Balance Sheet (as-of date), each with CSV export. **Reports > P&L** shows the same P&L report.
- **Settings > Chart of Accounts:** list/add/rename/deactivate accounts; Accounts Settings card: go-live date, locked-through date, default bank, Rebuild ledger.

## Access & safety
- All `/api/accounts/*` routes enforce **ADMIN + ACCOUNTANT** server-side (the nav already limits the hub to these roles; the API must not rely on that). Chart of Accounts edit: ADMIN/ACCOUNTANT too. Reading P&L under Reports: ADMIN/MANAGER as the Reports hub is.
- Everything is additive and inert until a go-live date is set: until then, `syncSource` does nothing, so deploying cannot change any business behaviour. Business routes call `syncSafe` which swallows/logs ledger errors.
- A locked period rejects manual postings and skips sync for sources dated inside it (the Rebuild report lists skipped sources).
- Amounts are `Decimal`, rounded to 2 places at each line; entries must balance exactly.

## Known limits (accepted)
- COGS accuracy depends on `unitCost` from FEFO at delivery; admin quantity edits on delivered orders are only approximated (same caveat the app already documents).
- No bank reconciliation, no multi-currency, no budgets, no FBR e-filing; depreciation is straight-line only.
- Existing invoice-derived outstanding views are not replaced; the AR/AP tabs show a reconciliation instead.

## Testing
`tsc`, unit tests (`node:test`) for the pure posting builders (every source's entry balances; edge cases: zero tax, bonus-only line, returns without restock, null unitCost) and for payroll and depreciation math; integration scripts against production with `QA`-prefixed records cleaned in `finally` (sync idempotence — run twice, same ledger; edit/delete a source → entries follow; locked period; role enforcement 403 for MANAGER/others; trial balance debits = credits; AR ledger vs invoice-derived outstanding); `npm run build`.
