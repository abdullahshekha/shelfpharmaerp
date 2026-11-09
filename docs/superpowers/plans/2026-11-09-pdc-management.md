# PDC (Post Dated Cheque) Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track customer (receivable) and supplier (payable) cheques as Pending/Stopped/Returned/Cleared promises; only on Clear do payments post, oldest invoice first, to the cheque's own bank account.

**Architecture:** New `Cheque` model. Clearing runs one interactive transaction that claims the cheque (Pending -> Cleared), allocates its amount across the party's oldest unpaid invoices, and creates one ordinary `Payment` / `SupplierPayment` row per invoice share (these rows are the frozen allocation). The existing accounting sync posts those payments; a new nullable `bankAccountId` on the payment rows makes the sync debit/credit the cheque's bank instead of the default bank. Choosing "Cheque" on the existing payment screens creates a Pending cheque instead of a payment.

**Tech Stack:** Next.js 14 App Router, Prisma 7 (audited client in `lib/prisma.ts`), Supabase Postgres, `npx tsx --test` unit tests, QA scripts against the live DB (QA-prefixed rows).

**Spec:** `docs/superpowers/specs/2026-11-09-pdc-management-design.md` (decisions, numbered calls 1-12 there are binding).

## Global Constraints

- Production DB, no staging: schema change purely additive (new `Cheque` table; nullable `chequeId`, `bankAccountId` on `Payment` and `SupplierPayment`). Push with `npx prisma db push` using the pooler-host `DIRECT_URL` override (the direct host is unreachable from this laptop). Re-check that no real `method = 'CHEQUE'` payments exist before pushing.
- Audited Prisma client only; **never** array-form `$transaction` for writes (interactive form `$transaction(async tx => ...)`); guarded by `tests/audit/no-array-transaction.test.ts`.
- Money is `Decimal(12,2)` in the DB, paisa integers in logic (`lib/accounting/money.ts` `toPaisa`/`fromPaisa`), PKR, dates in Asia/Karachi.
- Statuses are plain Strings: `PENDING | STOPPED | RETURNED | CLEARED`; direction `RECEIVABLE | PAYABLE`.
- Allowed transitions: PENDING -> STOPPED | RETURNED | CLEARED; STOPPED | RETURNED -> PENDING; CLEARED is final (only `notes` editable afterwards).
- Clearing: oldest-first by `invoiceDate` then `createdAt`; refused (409) if the cheque amount exceeds the party's total unpaid invoices; no credit/prepayment is ever created.
- Clearing date: on/after the cheque's `receivedDate`, not in the future (Karachi day), not before the accounting go-live date, not in a locked period (`assertNotLocked` from `lib/accounting/core.ts`).
- Existing accounting rules stay intact: a Rebuild must reproduce the same entries; hook syncs run AFTER the business transaction via `syncSafe('PAYMENT'|'SUPPLIER_PAYMENT', id)`.
- Roles: create/edit/status by ADMIN, MANAGER, ACCOUNTANT; SALESMAN may create RECEIVABLE cheques only and edit his own until acknowledged. **Acknowledge: ADMIN or MANAGER only.** Cheques recorded by ADMIN/MANAGER/ACCOUNTANT are auto-acknowledged. Clearing requires acknowledged + a bank account.
- QA: records prefixed `QA `, removed in `finally`; QA scripts that touch accounting must refuse to run if they would create real journal numbers on production data (follow `tests/accounting/qa-sync.ts` precedent: use only on a go-live-less guard or skip the ledger part; see Task 6).

## Review Focus

1. Clearing the same cheque twice at once (double tap / two managers): exactly one set of payments, second gets 409. Test in Task 4.
2. Cheque larger than total unpaid invoices: refused, nothing written. Task 2 (pure) + Task 4.
3. Two Pending cheques for one customer clearing one after the other: second pays the next-oldest open invoice, never over-pays an invoice. Task 4.
4. A Rebuild after clearing reproduces identical ledger entries (bank line goes to the cheque's bank, not the default). Task 3 + Task 6.
5. Clearing in a locked period or before go-live, or with a future clearing date: refused with nothing written. Task 4.

---

## File Structure

- `prisma/schema.prisma` — add `Cheque`; `chequeId`, `bankAccountId` on `Payment`/`SupplierPayment`.
- `lib/pdc/rules.ts` — pure: statuses, transition table, `allocateOldestFirst`.
- `lib/pdc/clear.ts` — `clearCheque(...)` transactional clearing.
- `lib/pdc/guard.ts` — role helpers for the cheque routes.
- `lib/accounting/builders.ts`, `lib/accounting/sync.ts` — bank account carried onto payment postings.
- `app/api/cheques/route.ts` (GET list, POST create), `app/api/cheques/[id]/route.ts` (GET, PATCH edit), `app/api/cheques/[id]/status/route.ts` (POST action).
- `app/api/invoices/[id]/payments/route.ts`, `app/api/purchase-invoices/[id]/payments/route.ts` — Cheque method creates a Pending cheque.
- `app/(erp)/accounts/pdc/page.tsx`, `components/pdc/*` — PDC Management UI; the two invoice pages' payment dialogs.
- `lib/nav.ts`, `tests/accounting/nav.test.ts` — nav tab.
- `tests/pdc/*.test.ts` (unit), `tests/pdc/qa-pdc.ts` (live-DB QA).

---

### Task 1: Schema and pure rules

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `lib/pdc/rules.ts`
- Test: `tests/pdc/rules.test.ts`

**Interfaces:**
- Produces (`lib/pdc/rules.ts`):
  - `type ChequeStatus = 'PENDING' | 'STOPPED' | 'RETURNED' | 'CLEARED'`, `type ChequeDirection = 'RECEIVABLE' | 'PAYABLE'`
  - `canTransition(from: ChequeStatus, to: ChequeStatus): boolean`
  - `type OpenInvoice = { id: string; duePaisa: number; sortDate: Date; createdAt: Date }`
  - `allocateOldestFirst(invoices: OpenInvoice[], amountPaisa: number): { allocations: { invoiceId: string; paisa: number }[]; remainderPaisa: number }` — sorts by `sortDate` then `createdAt` (does not mutate input), skips invoices with `duePaisa <= 0`, never allocates more than an invoice's due, `remainderPaisa > 0` means the cheque exceeds the open invoices.
- `Cheque` model fields: `id, direction, chequeNumber, amount Decimal(12,2), chequeDate DateTime, receivedDate DateTime, retailerId String?, supplierId String?, bankAccountId String?, drawerBank String?, pictureUrl String?, notes String?, status String @default("PENDING"), recordedById String?, acknowledgedAt DateTime?, acknowledgedById String?, clearedAt DateTime?, clearedById String?, replacedByNote String?, createdAt, updatedAt`; relations `retailer`, `supplier`; back-lists `payments Payment[]`, `supplierPayments SupplierPayment[]`; indexes on `(direction, status)`, `retailerId`, `supplierId`, `chequeDate`. `Payment` and `SupplierPayment` gain `chequeId String?` (relation to `Cheque`) and `bankAccountId String?` (plain string, no relation).

- [ ] **Step 1: Write failing tests** in `tests/pdc/rules.test.ts`: `canTransition('PENDING','CLEARED')` true; `('CLEARED', x)` false for every x; `('RETURNED','PENDING')` and `('STOPPED','PENDING')` true; `('RETURNED','CLEARED')` false; `allocateOldestFirst` with invoices due 10000/20000/5000 (oldest first) and amount 25000 -> allocations 10000 then 15000, remainder 0; amount 40000 -> remainder 5000; amount 0 -> no allocations; an invoice with `duePaisa` 0 is skipped; input array not mutated; ties on `sortDate` broken by `createdAt`.
- [ ] **Step 2: Run** `npx tsx --test tests/pdc/rules.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `lib/pdc/rules.ts` per the Interfaces block.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Schema.** Add the model/fields. Before pushing, run a row-count check with a one-off `pg` script: `SELECT count(*) FROM "Payment" WHERE method='CHEQUE'` and the same for `"SupplierPayment"`; report the counts. Push: `npx prisma db push` with the pooler `DIRECT_URL` override as used for the AuditLog table; then `npx prisma generate`; verify the table exists and the two columns exist.
- [ ] **Step 6: Commit** (`feat(pdc): cheque model and allocation rules`).

---

### Task 2: Bank account on payment postings

**Files:**
- Modify: `lib/accounting/builders.ts` (`CustomerPaymentInput`, `SupplierPaymentInput`, `buildCustomerPayment`, `buildSupplierPayment`), `lib/accounting/sync.ts` (the `PAYMENT` and `SUPPLIER_PAYMENT` cases)
- Test: `tests/accounting/builders.test.ts` (extend)

**Interfaces:**
- Consumes: `LineInput.accountId` (a line with `accountId` bypasses key resolution in `postEntry` and in the sync signature comparison).
- Produces: both input types gain `bankAccountId?: string | null`; when set and method is not CASH, the bank-side line uses `{ accountId: bankAccountId }` instead of `accountKey: 'BANK'`; CASH payments ignore it. The sync cases pass `r.bankAccountId`.

- [ ] **Step 1: Failing tests** in `builders.test.ts`: customer payment with `method:'CHEQUE', bankAccountId:'acc1'` -> debit line has `accountId:'acc1'` and no `accountKey`; same input without `bankAccountId` -> `accountKey:'BANK'` (unchanged behaviour); `method:'CASH'` with a bankAccountId -> still `accountKey:'CASH'`; supplier payment mirror (credit line).
- [ ] **Step 2: Run** `npx tsx --test tests/accounting/builders.test.ts` — expect FAIL on the new cases.
- [ ] **Step 3: Implement** the builder and sync changes.
- [ ] **Step 4: Run** all `tests/accounting/*.test.ts` — expect PASS, no regressions.
- [ ] **Step 5: Commit** (`feat(pdc): payments can post to a specific bank account`).

---

### Task 3: Cheque create, list, edit, status changes (no clearing yet)

**Files:**
- Create: `lib/pdc/guard.ts`, `app/api/cheques/route.ts`, `app/api/cheques/[id]/route.ts`, `app/api/cheques/[id]/status/route.ts`
- Test: `tests/pdc/guard.test.ts`

**Interfaces:**
- Consumes: `getUserFromRequest(req)` from `lib/utils/auth`; `canTransition` from `lib/pdc/rules`.
- Produces `lib/pdc/guard.ts`: `canManageCheques(role)` (ADMIN/MANAGER/ACCOUNTANT), `canAcknowledge(role)` (ADMIN/MANAGER), `canCreateCheque(role, direction)` (managers any direction; SALESMAN RECEIVABLE only; others false), `canEditCheque(user, cheque)` (managers until CLEARED; SALESMAN only if `recordedById === user.id` and not acknowledged; CLEARED: notes only, by managers).
- API contracts:
  - `GET /api/cheques?direction&status&bankAccountId&from&to&partyId&q&acknowledged&page` -> `{ data, total, totals: { receivable, payable } }`, 20 per page; SALESMAN sees only cheques he recorded; others 403.
  - `POST /api/cheques` body `{ direction, chequeNumber, amount, chequeDate, receivedDate?, retailerId|supplierId, bankAccountId?, drawerBank?, pictureUrl?, notes? }` -> 201; validates exactly one party matching direction, amount > 0, bank account (if given) is an active ASSET account with subType `BANK`; sets `recordedById`; auto-acknowledges unless role is SALESMAN.
  - `PATCH /api/cheques/[id]` edits allowed fields per `canEditCheque`.
  - `POST /api/cheques/[id]/status` body `{ action: 'acknowledge' | 'stop' | 'return' | 'represent' | 'clear', clearingDate?, bankAccountId?, notes? }`. This task implements `acknowledge`, `stop`, `return`, `represent` (-> PENDING) using a conditional `updateMany` on the expected current status (count 0 -> 409); `clear` returns 501 until Task 4.
- [ ] **Step 1: Failing tests** `tests/pdc/guard.test.ts` for each guard function including: SALESMAN cannot create PAYABLE; SALESMAN cannot edit another's cheque or an acknowledged one; nobody but notes after CLEARED; ACCOUNTANT cannot acknowledge.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** `guard.ts` then the three routes.
- [ ] **Step 4: Run** `npx tsx --test tests/pdc/*.test.ts` and `npx tsc --noEmit` — PASS / exit 0.
- [ ] **Step 5: Commit** (`feat(pdc): cheque API with roles and status transitions`).

---

### Task 4: Clearing

**Files:**
- Create: `lib/pdc/clear.ts`
- Modify: `app/api/cheques/[id]/status/route.ts` (wire `clear`)
- Test: `tests/pdc/clear-pure.test.ts`

**Interfaces:**
- Consumes: `allocateOldestFirst`, `invoiceDuePaisa` from `lib/utils/outstanding`, `getSettings`/`assertNotLocked` from `lib/accounting/core`, `syncSafe` from `lib/accounting/sync`, `parseDateInput` from `lib/accounting/dates`.
- Produces: `clearCheque(chequeId: string, actor: { id: string; role: string }, opts: { clearingDate?: Date; bankAccountId?: string }): Promise<{ payments: { id: string; invoiceId: string; amount: number }[] }>` and `class PdcError extends Error { status: number }` (400/403/409). Route maps `PdcError` to its status and `AccountingError` (lock/go-live) to its existing status.
- Behaviour, inside ONE interactive `prisma.$transaction(..., { maxWait: 10000, timeout: 20000 })`: (1) validate clearing date (rules in Global Constraints) and acknowledged + bank present; (2) take advisory lock `pg_advisory_xact_lock(hashtext('PDC_PARTY:' + partyId))`; (3) claim with `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CLEARED', clearedAt, clearedById } })`, count 0 -> `PdcError(409)`; (4) load the party's open invoices (customer: status UNPAID/PARTIAL/OVERDUE with payments; supplier: UNPAID/PARTIAL), map to `OpenInvoice` with `duePaisa`, allocate; `remainderPaisa > 0` -> throw `PdcError(409, 'Cheque amount exceeds unpaid invoices')` so the transaction (including the claim) rolls back; (5) create one `Payment`/`SupplierPayment` per allocation (`method:'CHEQUE'`, `reference: chequeNumber`, `paymentDate: clearingDate`, `chequeId`, `bankAccountId`), update each invoice status (PAID when total paid >= total, else PARTIAL); after commit call `syncSafe` for each payment.
- [ ] **Step 1: Failing tests** `tests/pdc/clear-pure.test.ts`: export and test a pure `validateClearingDate({ clearingDate, receivedDate, goLiveDate, lockedThrough, now })` that throws `PdcError`/lock error for: before receivedDate, future day, before go-live, on/before lockedThrough; passes for today.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** `lib/pdc/clear.ts` and wire the route action.
- [ ] **Step 4: Run** `npx tsx --test tests/pdc/*.test.ts`, `npx tsc --noEmit` — PASS / exit 0. DB behaviour (double clear, ordering, overpay) is proven by the QA script in Task 6.
- [ ] **Step 5: Commit** (`feat(pdc): clear a cheque and pay oldest invoices first`).

---

### Task 5: Existing payment screens create Pending cheques

**Files:**
- Modify: `app/api/invoices/[id]/payments/route.ts`, `app/api/purchase-invoices/[id]/payments/route.ts`, `app/(erp)/invoices/[id]/page.tsx`, `app/(erp)/purchase-invoices/[id]/page.tsx`
- Test: `tests/pdc/payment-route.test.ts` (pure helper)

**Interfaces:**
- Consumes: `canCreateCheque`, the cheque creation logic from Task 3 (extract a shared `createChequeRecord(user, input)` in `lib/pdc/create.ts` used by both `POST /api/cheques` and these routes).
- Produces: when `body.method === 'CHEQUE'` the two routes create a Pending RECEIVABLE/PAYABLE cheque for the invoice's party (`chequeNumber = body.reference` required -> 400 if blank, `chequeDate = body.chequeDate ?? paymentDate`, optional `bankAccountId`), create no payment, change no invoice status, and return `201 { data: { cheque }, pending: true }`. Non-cheque methods unchanged. Pure helper `chequeInputFromPayment(body, invoice, direction)` is unit-tested.
- UI: choosing Cheque shows a Cheque # (required), Cheque date and optional Bank selector (fetch bank accounts from existing accounts API; if the role cannot call it, hide the selector); the success toast says "Cheque recorded as Pending — it will be applied when cleared". The payments list on the invoice does not show Pending cheques (spec call 12).
- [ ] **Step 1: Failing tests** for `chequeInputFromPayment`: blank reference rejected; cheque date defaults to payment date; direction/party mapped correctly for customer and supplier.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** helper, routes, UI. **Step 4: Run** unit tests, `npx tsc --noEmit`, `npx next lint` on touched files — PASS.
- [ ] **Step 5: Commit** (`feat(pdc): cheque method on payment screens creates a pending cheque`).

---

### Task 6: PDC Management page, nav, live QA, docs

**Files:**
- Create: `app/(erp)/accounts/pdc/page.tsx`, `components/pdc/ChequeTable.tsx`, `components/pdc/ChequeForm.tsx`, `tests/pdc/qa-pdc.ts`
- Modify: `lib/nav.ts`, `tests/accounting/nav.test.ts`, `components/shared/HubTabs.tsx` if needed, `CLAUDE.md` (Phase 17 section; outside the repo like Phase 16, edit on disk)

**Interfaces:**
- Consumes: the Task 3/4 APIs.
- Nav: add `{ href: '/accounts/pdc', label: 'PDC Management', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] }` to the Accounts hub. A MANAGER then sees an Accounts hub holding only that tab (hub roles do not gate hubs that have tabs); the Accounts API routes keep their own guard. Update `tests/accounting/nav.test.ts` expectations accordingly.
- Page: tabs/filter Receivables | Payables | All, status filter, bank filter, date range, party search, cheque-number search, "Unacknowledged" filter; table columns number, party, amount, cheque date, bank, status badge, acknowledged marker; row actions per role and status (Acknowledge, Stop, Return, Re-present, Clear with clearing-date + bank dialog, Edit); totals for receivable and payable shown separately; "Add cheque" form; Cleared rows are read-only except notes.
- QA script `tests/pdc/qa-pdc.ts` (live DB, dev server :3100, QA-prefixed customer/supplier/invoices/cheques, cleaned in `finally`, leftover count printed): refuses to run if any journal entry exists on production (as the other accounting QA scripts do) — in that case run only the non-ledger checks (statuses, roles via forged-role cookies, allocation results on `Payment` rows, invoice statuses). Checks: pending cheque changes no balance/status; clear pays oldest first and splits across invoices; second cheque pays next-oldest; double clear (two parallel requests) -> exactly one 200, one 409, payments created once; cheque > unpaid -> 409 and cheque still Pending; clear on Returned -> 409; Returned -> re-present -> clear works; cleared cheque cannot change status or amount; SALESMAN cannot create PAYABLE, cannot acknowledge, cannot clear; unacknowledged cheque cannot clear; audit rows exist for create, acknowledge, clear.
- [ ] **Step 1: Failing test** — nav test updated first (`npx tsx --test tests/accounting/nav.test.ts` fails).
- [ ] **Step 2:** Implement nav, page and components; run nav test, `npx tsc --noEmit`, `npx next build` — PASS / exit 0.
- [ ] **Step 3:** Write and run `tests/pdc/qa-pdc.ts`; fix until all checks pass and leftovers are 0. Also run `npx tsx tests/audit/qa-audit.ts`-style leftover check for `QA ` rows only if it is safe (do NOT run the accounting QA scripts if journal entries exist).
- [ ] **Step 4:** Add the Phase 17 section to `CLAUDE.md` (what PDC is, the transition table, clearing rules, `Payment.chequeId/bankAccountId`, QA script caveat).
- [ ] **Step 5: Commit** (`feat(pdc): PDC Management page, nav, QA`).
