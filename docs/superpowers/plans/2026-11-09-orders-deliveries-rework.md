# Orders / Deliveries Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New order statuses (Order Received, Invoice Generated, Out for Delivery, then Delivered / On Hold / Returned), a 5-column delivery board, five delivery outcomes recorded by the assignee, manager/admin acknowledgement of cash/bank collections and returned stock, and logins plus a My Deliveries screen for Driver / Booker / Team Lead.

**Architecture:** `Order.status` becomes the single source of truth, changed only through lib functions in `lib/orders/` and `lib/deliveries/` (the routes stay thin). Stock leaves FEFO when a delivery is assigned (`OUT_FOR_DELIVERY`) and COGS posts from that moment. A delivery outcome is recorded by `recordOutcome`, which creates, depending on the outcome: a `DeliveryCollection` (cash/bank, waiting for acknowledgement), a Pending PDC cheque (existing module), and/or a `SalesReturn` whose lines are flagged not yet restocked. Acknowledgement functions create the real `Payment` and restock the returned lines. The ledger keeps using the existing sync/builders; AR still posts at invoice generation and returns credit AR through sales returns.

**Tech Stack:** Next.js 14 App Router, Prisma 7 (audited client; interactive `$transaction` only), Supabase Postgres + Storage, `npx tsx --test` unit tests, live-DB QA scripts (QA-prefixed rows).

**Spec:** `docs/superpowers/specs/2026-11-09-orders-deliveries-rework-design.md` (decisions and numbered calls 1-19 there are binding).

## Global Constraints

- Production DB, no staging. Schema changes additive. The old-status data conversion is a separate one-off script with a backup and a row-count check first; it is NOT run by tests and NOT run on production until the deploy step (Task 8) and only with the user's go-ahead.
- Audited Prisma client only; never array-form `$transaction` (interactive form, `{ maxWait: 10000, timeout: 20000 }`); guarded by `tests/audit/no-array-transaction.test.ts`.
- Order statuses (plain Strings): `RECEIVED | INVOICED | OUT_FOR_DELIVERY | DELIVERED | ON_HOLD | RETURNED | CANCELLED`. `DRAFT` and `PICKING` no longer exist after Task 3.
- Board columns (derived): Ready to Dispatch = `INVOICED` plus `ON_HOLD` whose `Delivery.scheduledDate` day has arrived (Karachi); Delivery Assigned = `OUT_FOR_DELIVERY`; Delivered; Returned; On Hold = `ON_HOLD` with a future date.
- Stock: deducted once, FEFO, at assignment, via `OrderItem.deductedQty` (null on legacy rows = ordered quantity; re-assignment after On Hold never deducts again; shortfall: assignment is refused for that order, others in a bulk batch proceed). Restored only by (a) manager/admin un-assigning before an outcome, (b) cancelling, (c) acknowledging returned stock. History is never deleted.
- COGS posts at the assignment date (`Delivery.assignedAt`), not at Delivered.
- Collected amount is fixed (order total, or total minus returned lines); no partial amounts. Pay Later collects nothing.
- Cash/Bank: customer balance changes only when a manager/admin acknowledges (the `Payment` row is created then, applied to that order's invoice, under the PDC_PARTY advisory lock `pg_advisory_xact_lock(hashtext('PDC_PARTY:' + retailerId))`). Cheque: created immediately as an unacknowledged Pending PDC cheque via `createChequeRecord` (`lib/pdc/create.ts`).
- Returned lines: a `SalesReturn` is created at outcome time with items `restocked: false`; acknowledgement restocks FEFO, sets `restocked: true` + `batchId`, and reduces the order line's `deductedQty` by the returned quantity. Whole-order Returned = a sales return of all lines.
- Authorization (server-side, not just nav): assigning/un-assigning/reassigning and acknowledging = ADMIN/MANAGER; recording an outcome = ADMIN/MANAGER or the delivery's `driverId` user; any assignee role (DRIVER, SALESMAN, SALES_REP, TEAM_LEAD) sees and acts only on deliveries where `driverId = session.id`. A manager/admin may acknowledge their own entries (the audit log records who).
- Reasons: Returned / returned lines: `no cash | not required | wrong order | late` (line reason optional; whole-order reason required). On Hold reason required: `no cash | shop closed`, plus a new date (not in the past, Karachi). Stored as the string values listed.
- Pictures: stored in the existing Supabase Storage bucket `retailer-photos` under the prefix `delivery/` (pattern of `app/api/retailers/upload-photo/route.ts`); cash/bank collections and cheques require one.
- Accounting lock/go-live rules apply to everything that posts; refuse (409) rather than force.
- Karachi timezone; money Decimal, paisa integers in logic (`lib/accounting/money.ts`).
- Existing helpers to reuse: `deductFefo`, `restockFefo`, `unitCostFrom`, `restockQtyFor` (`lib/accounting/cost.ts`), `totalUnits` (`lib/orders/units.ts`), `syncAllSafe` (`lib/accounting/sync.ts`), `assertNotLocked`/`getSettings` (`lib/accounting/core.ts`), `createChequeRecord` (`lib/pdc/create.ts`), `getUserFromRequest`/`requireRole` (`lib/utils/auth.ts`).

## Review Focus

1. Stock deducted or restocked twice: double-tap assign, On Hold then re-assign, double acknowledge of returned stock, cancel after a return. Tests in Tasks 2, 4, 5.
2. A collection must not touch the customer's balance before acknowledgement, and a double-tapped acknowledge creates exactly one payment. Task 5.
3. An assignee seeing or acting on someone else's delivery (list, detail, outcome endpoints), and a DRIVER/BOOKER/TEAM_LEAD reaching pages beyond My Deliveries plus their existing access. Tasks 4, 6, 7.
4. Ledger: COGS dated at assignment, return credit plus restock entry only after acknowledgement, a Rebuild reproducing the same entries, refusal in a locked period. Tasks 2, 5, 8.
5. Old data: every order converted, nothing already DELIVERED deducts again, nothing references a removed status after Task 3 (grep the repo for `'PICKING'`, `'DISPATCHED'`, `'CONFIRMED'`, `'PENDING'` order uses, `'DRAFT'` order uses). Tasks 3, 8.

---

## File Structure

- `prisma/schema.prisma` — `Delivery.assignedAt`, `Delivery.outcome*` fields, `DeliveryCollection`, `SalesReturn.orderId/deliveryId/stockAcknowledgedAt/stockAcknowledgedById`.
- `lib/orders/status.ts` — pure status constants, old-to-new mapping, transitions, board-column derivation.
- `lib/orders/set-status.ts`, `lib/orders/lifecycle.ts`, `lib/accounting/sync.ts` (+ builders if needed) — stock-out at assignment, COGS keyed to assignment, cancel/un-assign restock.
- `lib/deliveries/assign.ts` — assign / bulk assign / unassign / reassign.
- `lib/deliveries/outcome.ts` (+ `lib/deliveries/outcome-rules.ts` pure validation) — `recordOutcome`.
- `lib/deliveries/acknowledge.ts` — acknowledge collection / returned stock.
- `app/api/deliveries/**`, `app/api/delivery-acknowledgements/**`, `app/api/deliveries/upload-picture/route.ts`.
- `app/(erp)/deliveries/page.tsx` (5-column board), `app/(erp)/my-deliveries/page.tsx`, `components/deliveries/*`, `app/(erp)/deliveries/acknowledgements/page.tsx`.
- `scripts/convert-order-statuses.ts` — one-off conversion.
- `lib/nav.ts`, `middleware.ts` (only if needed), tests under `tests/deliveries/` and `tests/orders/`.

---

### Task 1: Schema and pure status rules

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `lib/orders/status.ts`, `lib/deliveries/outcome-rules.ts`
- Test: `tests/orders/status.test.ts`, `tests/deliveries/outcome-rules.test.ts`

**Interfaces:**
- Produces (`lib/orders/status.ts`): `type OrderStatus = 'RECEIVED'|'INVOICED'|'OUT_FOR_DELIVERY'|'DELIVERED'|'ON_HOLD'|'RETURNED'|'CANCELLED'`; `ORDER_STATUSES`; `STOCK_OUT_STATUSES = ['OUT_FOR_DELIVERY','DELIVERED','ON_HOLD','RETURNED']` (statuses in which the order's stock has left); `mapOldStatus(old: string): OrderStatus | 'DELETE'` (PENDING→RECEIVED, CONFIRMED/PICKING→INVOICED, DISPATCHED→OUT_FOR_DELIVERY, DELIVERED→DELIVERED, CANCELLED→CANCELLED, DRAFT→'DELETE'); `canMove(from: OrderStatus, to: OrderStatus): boolean` (RECEIVED→INVOICED|CANCELLED; INVOICED→OUT_FOR_DELIVERY|CANCELLED; OUT_FOR_DELIVERY→DELIVERED|RETURNED|ON_HOLD|INVOICED(un-assign)|CANCELLED; ON_HOLD→OUT_FOR_DELIVERY|CANCELLED; DELIVERED, RETURNED, CANCELLED final except CANCELLED via the existing admin paths); `boardColumn(order: { status: string }, delivery: { scheduledDate: Date }, now: Date): 'READY'|'ASSIGNED'|'DELIVERED'|'RETURNED'|'ON_HOLD'|null` (Karachi day comparison for ON_HOLD).
- Produces (`outcome-rules.ts`): `type Outcome = 'PAID_FULL'|'PAID_WITH_RETURN'|'RETURNED'|'ON_HOLD'|'PAY_LATER'`; `RETURN_REASONS`, `HOLD_REASONS`; `validateOutcomeInput(input, order: { items: {id: string; quantity: number}[]; totalAmount: number; ... }, now: Date): { ok: true; amountDuePaisa: number; returnedLines: {orderItemId: string; quantity: number; reason?: string}[] } | { ok: false; error: string }` — rules: PAID_FULL needs method `CASH|BANK|CHEQUE`; CASH/BANK need `pictureUrl`, BANK needs `bankAccountId`; CHEQUE needs cheque number, cheque date and `pictureUrl`; PAID_WITH_RETURN needs at least one returned line, 0 < qty ≤ ordered qty per line, not every unit (that is RETURNED), then same payment rules on the remaining amount; RETURNED needs a reason in RETURN_REASONS; ON_HOLD needs a reason in HOLD_REASONS and a `holdUntil` not before today (Karachi); PAY_LATER needs nothing; the amount due is computed server-side, never taken from input.
- Schema: `Delivery` gains `assignedAt DateTime?`, `outcome String?`, `outcomeReason String?`, `outcomeAt DateTime?`, `outcomeById String?`, `outcomePictureUrl String?`. New `DeliveryCollection { id, deliveryId, orderId, invoiceId, retailerId, method ('CASH'|'BANK'), amount Decimal(12,2), bankAccountId String?, pictureUrl String, collectedById String, collectedAt DateTime @default(now()), acknowledgedById String?, acknowledgedAt DateTime?, paymentId String? @unique }` with indexes on `deliveryId`, `acknowledgedAt`. `SalesReturn` gains `orderId String?`, `deliveryId String?`, `stockAcknowledgedAt DateTime?`, `stockAcknowledgedById String?` (indexes on `orderId`). Existing rows unaffected.

- [ ] **Step 1: Failing tests.** `status.test.ts`: `mapOldStatus` for every old value; `canMove` allowed/forbidden pairs listed above (including DELIVERED and RETURNED final, ON_HOLD→INVOICED forbidden); `boardColumn` for each status, an ON_HOLD order with a future date vs a date that is today in Karachi (late-night UTC edge). `outcome-rules.test.ts`: each outcome's valid and invalid inputs (missing picture, missing bank for BANK, cheque without number, returned qty above ordered, all lines returned under PAID_WITH_RETURN, hold date yesterday, unknown reason) and the computed `amountDuePaisa` for PAID_WITH_RETURN (order total minus returned lines, using lineTotal proportionally plus sales tax per unit, same arithmetic as the invoice) with a worked example including sales tax and a discount line.
- [ ] **Step 2: Run** `npx tsx --test tests/orders/status.test.ts tests/deliveries/outcome-rules.test.ts` — FAIL.
- [ ] **Step 3: Implement** both pure modules to the Interfaces block (no Prisma imports).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Schema.** Add the fields/model. Row-count check with a one-off `pg` script (orders by status; deliveries; sales returns) and report; `npx prisma db push` with the pooler `DIRECT_URL` override (as for AuditLog and Cheque); `npx prisma generate`; verify the table and columns exist and nothing dropped.
- [ ] **Step 6: Commit** (`feat(deliveries): schema and pure status/outcome rules`).

---

### Task 2: Stock-out at assignment, COGS and cancel rules

**Files:**
- Create: `lib/deliveries/assign.ts`
- Modify: `lib/orders/set-status.ts`, `lib/orders/lifecycle.ts`, `lib/accounting/sync.ts` (the `DELIVERY_COGS` load and its rebuild query)
- Test: `tests/deliveries/assign-pure.test.ts`, extend `tests/accounting/*` where the COGS source rule is tested

**Interfaces:**
- Consumes: `canMove`, `STOCK_OUT_STATUSES` from `lib/orders/status.ts`; `deductFefo`, `restockFefo`, `restockQtyFor`.
- Produces (`lib/deliveries/assign.ts`):
  - `assignDelivery(deliveryId: string, driverId: string, actor: { id: string; role: string }): Promise<{ warnings: string[] }>` — order must be `INVOICED` or `ON_HOLD`; claims the order with a conditional `updateMany` to `OUT_FOR_DELIVERY`; deducts FEFO per line **only for lines whose `deductedQty` is null/0** (so re-assignment after On Hold deducts nothing), sets `unitCost`/`deductedQty`, sets `Delivery.driverId`, `assignedAt` (kept on re-assignment) and `status` `OUT_FOR_DELIVERY`; throws `AssignError(409, 'Not enough stock for <medicine>')` and rolls back when any line would be short; assignee must be an active Employee with role in DRIVER/SALESMAN/SALES_REP/TEAM_LEAD; actor must be ADMIN/MANAGER.
  - `assignDeliveries(ids: string[], driverId: string, actor): Promise<{ assigned: string[]; refused: { id: string; error: string }[] }>` — one transaction per delivery.
  - `unassignDelivery(deliveryId, actor)` — only while `OUT_FOR_DELIVERY` with no outcome: restocks `deductedQty` back (reusing `restockOrderItems`), clears `unitCost/deductedQty`, order back to `INVOICED`, driver cleared; `reassignDelivery(deliveryId, driverId, actor)` changes only `driverId` (no stock effect).
  - Class `AssignError extends Error { status: number }`.
- Ledger: `DELIVERY_COGS` posts when the order status is in `STOCK_OUT_STATUSES` and its lines have `unitCost`; its date is `Delivery.assignedAt` (fallback chain: assignedAt, deliveredAt, invoice date, order date); the rebuild query in `sync.ts` mirrors this. An order moved back to `INVOICED` (un-assign) removes the entry on the next sync. `undeliverInTx`/`cancelOrder`/`hardDeleteOrder` in `lifecycle.ts` generalise from "was DELIVERED" to "status in STOCK_OUT_STATUSES and stock still deducted": a cancelled `OUT_FOR_DELIVERY`/`ON_HOLD` order restocks its remaining `deductedQty`; a `RETURNED` or return-acknowledged order restocks only what is still deducted (`deductedQty` was reduced at acknowledgement); the locked-COGS refusal stays.
- `setOrderStatus` keeps handling RECEIVED→INVOICED (invoice + delivery + challan creation, as `CONFIRMED` does today) but no longer deducts stock itself; it delegates assignment to `assignDelivery`.

- [ ] **Step 1: Failing tests.** Pure: `assign-pure.test.ts` for the line-selection helper `linesToDeduct(items)` (only lines with null/0 `deductedQty`; bonus units included via `totalUnits`) and a `canAssign(orderStatus, role)` helper. Accounting: a sync-level/pure test that the COGS source date uses `assignedAt` and that an `INVOICED` order yields no entry (extend the existing builders/sync tests the way `tests/accounting/builders.test.ts` is structured; if `load()` cannot be tested purely, extract the date/eligibility rule into a pure function and test that).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npx tsx --test tests/deliveries/*.test.ts tests/orders/*.test.ts tests/accounting/*.test.ts tests/audit/*.test.ts` and `npx tsc --noEmit` — PASS / 0. Live proof (double assign, On Hold re-assign, short stock) is in Task 8's QA; the code paths must exist now.
- [ ] **Step 5: Commit** (`feat(deliveries): stock leaves at assignment, COGS from assignment date`).

---

### Task 3: New statuses everywhere and removal of Draft/Picking

**Files:**
- Modify: every file that reads or writes an order status — start from `grep -rn "'PICKING'\|'DISPATCHED'\|'CONFIRMED'\|'PENDING'\|'DRAFT'" app lib components` (known: `app/(erp)/orders/*`, `app/(erp)/invoices/*`, `app/api/orders/**`, `app/api/portal/orders/route.ts`, `lib/portal/*`, `app/api/dashboard/stats/route.ts`, `app/api/reports/sales/route.ts`, `app/api/purchase-demand/route.ts`, `app/api/approvals/[id]/route.ts`, `lib/challan.ts`, `lib/orders/draft.ts`, `app/api/orders/[id]/draft/route.ts`, `lib/accounting/sync.ts` invoice DRAFT handling is about Invoice.status, not Order — leave it)
- Create: `scripts/convert-order-statuses.ts`
- Test: `tests/orders/status-consumers.test.ts` (pure helpers), existing portal/order tests updated

**Interfaces:**
- Consumes: `lib/orders/status.ts`.
- Produces: all consumers use the new values; a shared `ORDER_STATUS_LABEL: Record<OrderStatus, string>` (`Order Received`, `Invoice Generated`, `Out for Delivery`, `Delivered`, `On Hold`, `Returned`, `Cancelled`) in `lib/orders/status.ts` used by every page badge/filter. `POST /api/orders` creates `RECEIVED` orders (no `status: 'DRAFT'`); draft routes/UI (`/orders/new?draft=`, `PUT /api/orders/[id]/draft`, `lib/orders/draft.ts`) are deleted; "Confirm" on an order (`PUT /api/orders/[id]/status` with `INVOICED`) is the RECEIVED→INVOICED action (manager/admin), all other status moves go through the delivery functions; direct status writes to `OUT_FOR_DELIVERY/DELIVERED/ON_HOLD/RETURNED` through the generic status route are rejected with 400. Portal open order = `RECEIVED` + `OFFER_LIST` (the existing "no invoice" guard stays). Purchase demand "pending orders" = `RECEIVED`, `INVOICED`, `OUT_FOR_DELIVERY`, `ON_HOLD`. Dashboard/report "excludes drafts" logic becomes "all statuses except CANCELLED" where it excluded DRAFT today.
- `scripts/convert-order-statuses.ts`: dry-run by default (prints counts per old status and what each would become), `--apply` performs `mapOldStatus` for `Order.status` and fixes `Delivery.status`, refuses to run without `--backup <path>` (writes a JSON dump of affected orders/deliveries first); DRAFT orders are deleted via the audited client (items cascade); every order already DELIVERED keeps `deductedQty` as is; orders converted to `OUT_FOR_DELIVERY` that never had stock deducted are listed in the output as needing review (they cannot be auto-deducted).

- [ ] **Step 1: Failing tests** for the pure pieces: `ORDER_STATUS_LABEL` completeness for all `OrderStatus` values, the status-route validation helper (`canSetViaStatusRoute(to)` true only for `INVOICED` and `CANCELLED`), `mapOldStatus` round-trip table used by the script (script logic factored into a pure `planConversion(rows)` returning the update list and the review list; test it with sample rows including DRAFT and an OUT_FOR_DELIVERY-without-deduction case).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** all consumer changes, delete draft code, add the script. **Step 4:** `grep` again to prove no remaining uses of the removed statuses (report the command and empty output), run `npx tsx --test tests/**/*.test.ts` equivalents (pdc, audit, accounting, portal, pricing, orders, inventory, ui, deliveries), `npx tsc --noEmit`, `npx next build` — PASS. Do NOT run the script with `--apply`.
- [ ] **Step 5: Commit** (`feat(orders): new status model, drafts removed, conversion script`).

---

### Task 4: Assignment and outcome API

**Files:**
- Create: `lib/deliveries/outcome.ts`, `app/api/deliveries/upload-picture/route.ts`, `app/api/deliveries/[id]/outcome/route.ts`, `app/api/deliveries/[id]/assign/route.ts`
- Modify: `app/api/deliveries/route.ts` (list scoping for every assignee role, new filters), `app/api/deliveries/[id]/route.ts` (reduced to notes/reassign through `assign.ts`; the old `start|deliver|fail|reschedule` actions removed), `app/api/deliveries/bulk/route.ts` (uses `assignDeliveries`)
- Test: `tests/deliveries/outcome-guard.test.ts`

**Interfaces:**
- Consumes: Task 1 rules, Task 2 `assign.ts`, `createChequeRecord`, `deductFefo` not needed here.
- Produces (`lib/deliveries/outcome.ts`): `recordOutcome(deliveryId: string, actor: { id: string; role: string }, input: OutcomeInput): Promise<{ outcome: Outcome; collectionId?: string; chequeId?: string; salesReturnId?: string }>`; `canRecordOutcome(actor, delivery: { driverId: string | null }): boolean` (ADMIN/MANAGER or `driverId === actor.id`, pure and unit-tested). Inside ONE interactive transaction: claim `OUT_FOR_DELIVERY` (conditional `updateMany`; count 0 → 409 so a double tap records once); validate via `validateOutcomeInput` (server computes the amount); then per outcome — `PAID_FULL`: CASH/BANK → insert a `DeliveryCollection`; CHEQUE → `createChequeRecord` (RECEIVABLE, unacknowledged, picture in `pictureUrl`); order → `DELIVERED`; `PAID_WITH_RETURN`: create the `SalesReturn` (SP-SRET number via the existing generator, `orderId`/`deliveryId` set, items `restocked: false`, `unitPrice` = the order line's effective price per unit, reasons) and the collection/cheque for the remaining amount; order → `DELIVERED`; `RETURNED`: sales return of all lines, order → `RETURNED`; `ON_HOLD`: reason + `scheduledDate = holdUntil`, order → `ON_HOLD`, `driverId` kept; `PAY_LATER`: nothing collected, order → `DELIVERED`. Always sets `Delivery.outcome/outcomeReason/outcomeAt/outcomeById/deliveredAt` (deliveredAt for DELIVERED). After commit `syncAllSafe` for the sales return (`SALES_RETURN`) so the AR credit posts.
- Routes: `POST /api/deliveries/[id]/outcome` (body = `OutcomeInput`, 403 unless `canRecordOutcome`, errors mapped from `OutcomeError`/`AssignError`/`AccountingError`/`ChequeError`); `POST /api/deliveries/[id]/assign` `{ driverId }` | `{ unassign: true }` (ADMIN/MANAGER); `PUT /api/deliveries/bulk` `{ ids, driverId }` returns `{ assigned, refused }`; `POST /api/deliveries/upload-picture` (multipart; any authenticated assignee or manager; image types only, size cap, stores under `delivery/` in the `retailer-photos` bucket, returns `{ url }`); `GET /api/deliveries` scoping: ADMIN/MANAGER see all, every other role only `driverId = session.id`, regardless of query params.

- [ ] **Step 1: Failing tests:** `canRecordOutcome` matrix (manager, admin, assignee, other assignee, accountant, no session), plus a pure `buildSalesReturnLines(order, returnedLines)` helper (line totals, tax-inclusive credit per the invoice arithmetic, rounding in paisa) tested against the worked example from Task 1.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the lib function, helper and routes. **Step 4:** `npx tsx --test tests/deliveries/*.test.ts tests/orders/*.test.ts tests/pdc/*.test.ts tests/audit/*.test.ts`, `npx tsc --noEmit`, eslint on touched files — PASS. Live behaviour (double tap, each outcome) is proven in Task 8's QA.
- [ ] **Step 5: Commit** (`feat(deliveries): assignment and outcome API`).

---

### Task 5: Acknowledgements

**Files:**
- Create: `lib/deliveries/acknowledge.ts`, `app/api/delivery-acknowledgements/route.ts` (GET both lists), `app/api/delivery-acknowledgements/collections/[id]/route.ts` (POST), `app/api/delivery-acknowledgements/returns/[id]/route.ts` (POST)
- Test: `tests/deliveries/acknowledge-pure.test.ts`

**Interfaces:**
- Produces: `acknowledgeCollection(collectionId: string, actor: { id: string; role: string }): Promise<{ paymentId: string }>` — ADMIN/MANAGER only; one interactive transaction: take the PDC_PARTY advisory lock for the collection's `retailerId`, claim `DeliveryCollection` with conditional `updateMany where { id, acknowledgedAt: null }` (count 0 → 409), create the `Payment` (`invoiceId` = the order's invoice, `method` `CASH` or `BANK_TRANSFER`, `bankAccountId` for BANK, `paymentDate` = today Karachi, `reference` = delivery/order number, `chequeId` null), recompute the invoice status from payments read inside the lock (same rule as the payment routes), set `paymentId`; refuse (409) if the amount exceeds the invoice's still-unpaid amount or if go-live/lock rules refuse the date; `syncAllSafe([['PAYMENT', paymentId]])` after commit. `acknowledgeReturnedStock(salesReturnId: string, actor): Promise<{ warnings: string[] }>` — ADMIN/MANAGER only; claim with conditional `updateMany where { id, stockAcknowledgedAt: null }`; for each item restock FEFO (`restockFefo`) setting `restocked: true` and `batchId`, reduce the matching `OrderItem.deductedQty` by the returned quantity (never below 0), set `stockAcknowledgedAt/ById`; after commit sync `SALES_RETURN` so the restock entry (Dr Inventory / Cr COGS) posts. Cheques use the existing PDC acknowledge action, not these routes. `GET` returns collections with `acknowledgedAt: null` and sales returns with `deliveryId` set and `stockAcknowledgedAt: null`, each with order number, customer, amounts, picture, who collected/recorded.
- A pure helper `unpaidAfterPaymentsPaisa(invoiceTotalPaisa, paymentsPaisa)` (can live in `lib/deliveries/acknowledge-rules.ts`) is unit-tested: exact settle, over-amount refusal, rounding.

- [ ] **Step 1: Failing tests** for the helper and the role guard (`canAcknowledge(role)` ADMIN/MANAGER only; ACCOUNTANT and assignees refused).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** run the deliveries/orders/accounting/pdc/audit tests, `npx tsc --noEmit`, eslint — PASS. Live proof (single payment on double acknowledge, restock once) is Task 8.
- [ ] **Step 5: Commit** (`feat(deliveries): acknowledgement of collections and returned stock`).

---

### Task 6: Deliveries board, My Deliveries and outcome dialog

**Files:**
- Modify: `app/(erp)/deliveries/page.tsx` (5-column board using `boardColumn`), `lib/deliveries/columns.ts` (replace with the new derivation or delete in favour of `lib/orders/status.ts`)
- Create: `app/(erp)/my-deliveries/page.tsx`, `components/deliveries/OutcomeDialog.tsx`, `components/deliveries/AssignDialog.tsx`, `components/deliveries/DeliveryCard.tsx`
- Test: `tests/deliveries/ui-helpers.test.ts` (pure card-action helper)

**Interfaces:**
- Consumes: Task 4 routes, `boardColumn`, `ORDER_STATUS_LABEL`.
- Produces: pure `cardActions(role: string, userId: string, delivery: { driverId: string | null }, column: Column): ('assign'|'reassign'|'unassign'|'outcome')[]` (unit-tested; mirrors the server rules so the UI never offers what the API refuses). Board: the five columns, manager/admin can assign (single and bulk) from Ready to Dispatch and move Delivery Assigned cards to an outcome; each assignee sees the same page only with their own deliveries; My Deliveries lists only the logged-in user's assigned and on-hold-today deliveries with the outcome dialog. Outcome dialog: choose one of the five outcomes; Paid in Full → method (Cash / Bank / Cheque), Bank account select for Bank (from `/api/cheques/banks`, shown for every role that may record outcomes), picture upload (camera capture input like Add Customer) required for all three methods, cheque number/date fields for Cheque; Paid with Return → pick lines and quantities with optional reason, amount to collect shown (computed by the same pure arithmetic and re-computed on the server), then payment as above; Returned → reason; On Hold → reason and date; Pay Later → confirm. Amount is shown read-only.

- [ ] **Step 1: Failing test** for `cardActions` (manager vs assignee vs other assignee, each column). **Step 2: Run** — FAIL. **Step 3: Implement** board, pages, dialogs. **Step 4:** unit tests, `npx tsc --noEmit`, eslint, `npx next build` — PASS; state plainly whether the pages were checked in a browser.
- [ ] **Step 5: Commit** (`feat(deliveries): five-column board, My Deliveries, outcome dialog`).

---

### Task 7: Acknowledgement screens, nav, roles, order pages

**Files:**
- Create: `app/(erp)/deliveries/acknowledgements/page.tsx`, `components/deliveries/AckLists.tsx`
- Modify: `lib/nav.ts`, `tests/accounting/nav.test.ts` (and any nav test the change affects), `middleware.ts` only if a role/page gate needs it, `app/(erp)/orders/page.tsx` and `app/(erp)/orders/[id]/page.tsx` (new statuses, Confirm/"Generate Invoice" action, delivery outcome and acknowledgement info on the order), `components/shared/*` if the layout defaults roles

**Interfaces:**
- Nav: add a Sales-hub tab `{ href: '/deliveries/acknowledgements', label: 'Acknowledgements', roles: ['ADMIN','MANAGER'] }` and a way to reach `/my-deliveries` for `DRIVER`, `SALES_REP`, `TEAM_LEAD` and `SALESMAN` **in addition to their existing access** (a Booker keeps Add Customer, a Team Lead keeps Dashboard/Inventory/Customers/Orders/Invoices, a Salesman's Deliveries tab becomes My Deliveries); a Driver sees only My Deliveries. Update the nav tests first (they must fail), then make them pass; `/deliveries` (full board) stays ADMIN/MANAGER.
- Pages: acknowledgement screen with two lists (cash/bank collections with picture preview and an Acknowledge button; returned stock with lines and an Acknowledge stock received button), cheques show a link to PDC Management. Order detail shows status label, the delivery outcome, reason, collection/return info and (ADMIN) the existing History panel unchanged. Orders list filters use the new statuses.
- Login: a Driver/Booker/Team Lead can already log in once HR gives them a username and password (the login route has no role restriction); verify the layout, sidebar and `/` redirect work for a role whose only nav entry is My Deliveries, and that login-blocked users stay blocked. HR page: allow setting username/password for DRIVER (check `app/(erp)/hr/[id]/page.tsx` and its API do not filter the role out).

- [ ] **Step 1:** update `tests/accounting/nav.test.ts` and `tests/audit/nav.test.ts` expectations first — run, expect FAIL. **Step 2:** implement. **Step 3:** run all unit suites, `npx tsc --noEmit`, `npx next build` — PASS; state plainly whether pages were checked in a browser.
- [ ] **Step 4: Commit** (`feat(deliveries): acknowledgements screen, navigation and role access`).

---

### Task 8: Live QA, conversion script run plan, docs

**Files:**
- Create: `tests/deliveries/qa-deliveries.ts`
- Modify: `C:\Users\OK COMPUTER\Desktop\AI Projects\Pharma\CLAUDE.md` (Phase 18 section; outside the git repo, edit on disk)

**Interfaces:** Live QA (dev server on :3100 started with `PDC_TEST_SKIP_SYNC=1 AUDIT_ALLOW_PURGE=1` plus a new `DELIVERY_TEST_SKIP_SYNC=1` honoured only when `NODE_ENV !== 'production'` that skips the post-commit `syncAllSafe` in the new lib functions, so no real journal entries/numbers are created on production; preflight proves the server runs that way, like the PDC QA). QA-prefixed customer, medicine, batches, orders only; everything removed in `finally`, leftover counts printed (must be 0); refuses to run if foreign `QA ` records exist or if any journal entry references QA data.

Checks: assign deducts FEFO stock once; double-tap assign → one 200 + one 409 and stock deducted once; short stock refuses with 409 and changes nothing; bulk assign with one short order assigns the rest; On Hold keeps stock out, order reappears READY on its date, re-assign deducts nothing; unassign restocks and returns to INVOICED; each outcome (Paid in Full by cash/bank/cheque, Paid with Return, Returned, On Hold, Pay Later) sets the right statuses and records the right rows; cash/bank collection leaves the invoice unpaid and the customer balance unchanged until acknowledged, double acknowledge creates exactly one payment and invoice becomes PAID; cheque outcome creates an unacknowledged Pending PDC cheque; returned stock stays out until acknowledged, double acknowledge restocks once, `deductedQty` reduced; cancel after return restocks only what is still out; assignee A cannot see, assign, outcome or upload against assignee B's delivery, DRIVER/SALES_REP/TEAM_LEAD cookies reach only their own; ACCOUNTANT cannot acknowledge; generic status route refuses OUT_FOR_DELIVERY/DELIVERED; audit rows exist for assignment, outcome and both acknowledgements; `scripts/convert-order-statuses.ts` dry-run on QA-status fixtures (planConversion on inserted QA rows) prints the expected plan and `--apply` without `--backup` refuses.

- [ ] **Step 1:** write and run the QA until all checks pass and leftovers are 0 (never touch accounting settings, never create real journal entries). **Step 2:** fix any defect it exposes in earlier tasks' code only if tiny; otherwise report it. **Step 3:** write the Phase 18 section in `CLAUDE.md` (statuses and transitions, stock/COGS timing, outcomes, collections and acknowledgements, role access, picture storage, the conversion script and its deploy procedure, the QA switches and caveats, known limits). **Step 4:** report the exact deploy procedure for the user to approve: (a) row counts and a backup, (b) deploy, (c) run the conversion script immediately after the deploy, (d) smoke checks. Do not run the conversion against production.
- [ ] **Step 5: Commit** (`feat(deliveries): live QA, docs`).
