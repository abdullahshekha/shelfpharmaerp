# Client Feedback Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make offer-list Comment discounts and purchase sales tax actually flow into Sales Invoices and the Customer Portal, fix Deliveries, and ship the client's smaller UX asks.

**Architecture:** One pure pricing module (`lib/utils/offer-pricing.ts`) is the single source for Bonus / Extra % / Net / MOQ / sales-tax math, used by the staff Sales Invoice page, the portal server pricing and the portal client estimate. Sales tax moves onto `MedicineBatch` (additive column). Order-status logic is extracted into one shared function so the Deliveries board and the order status route cannot diverge.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma (Postgres, production DB), `node:test` via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-client-feedback-round-design.md` (read its "Decisions" and "Calls made by the designer" sections first).

## Global Constraints

- Production DB, no staging: schema changes additive only; run a row-count check (`node` + `pg`, `DATABASE_URL` via `dotenv`) before any `npx prisma db push`.
- Never `git push` (it redeploys production). Commit locally only; run `npx next build` before handing off.
- Reuse `lib/utils/pricing.ts` and `lib/utils/offer-comment.ts`; do not copy formulas inline.
- Bonus = free units, `floor(paidQty / commentMinOrderQty) * commentQtyFree`; threshold and sales tax use the **paid** quantity only; free units are deducted from stock and carry no tax; line total unchanged.
- Net MOQ extra = percent off the net price when `qty >= commentMinOrderQty`.
- An offer item has exactly one `commentType`; MOQ field is `commentMinOrderQty`, extra % field is `commentExtraPercent`.
- Sales tax is a flat Rs/unit, only when `Medicine.salesTaxApplicable`; locked on the order line at creation (never re-derived); source order: FEFO batch `salesTax` → `OfferListItem.salesTax` → 0.
- Customers never see cost, Purchase %, or stock; portal responses stay whitelisted (`toPublicItem`).
- Net-price items: customer surfaces (portal, offer-list HTML export, PDF, per-customer quantity sheet) show a blank T.P. and the net price in Comments; staff views keep T.P.
- Test/QA records use the `QA ` prefix and are deleted afterwards. Do NOT run `tests/portal/qa-offer.ts` or `qa-orders.ts` against production.
- Dates in `Asia/Karachi`; money as `Decimal` in the DB.

## Review Focus

- Bonus below the MOQ (qty 9 for "10 + 2") gives 0 free; qty 0 gives 0 lines/units (pinned in Task 1).
- Comment with a missing field (Bonus without min/free, Net without net price, Extra % without MOQ) must not apply anything or crash (Task 1).
- Legacy batch with null `salesTax` falls back to the offer-list tax, then 0 (Task 1, Task 3).
- Marking Delivered twice (board double-tap) must not deduct stock twice (Task 6).
- Bonus units exceeding available stock record the real `deductedQty` (shortfall) rather than going negative (Task 4).
- A DRAFT never creates an invoice, delivery, stock movement or ledger entry, and never appears in dashboard/aging/deliveries (Task 7).
- Deleting a medicine that an offer list or order references returns 409 and changes nothing (Task 8).

---

### Task 1: Offer pricing module

**Files:**
- Create: `lib/utils/offer-pricing.ts`
- Test: `tests/pricing/offer-pricing.test.ts`

**Interfaces:**
- Produces:
  - `interface OfferRule { commentType: string; offerPercent: number; commentNetPrice: number | null; commentMinOrderQty: number | null; commentQtyFree: number | null; commentExtraPercent: number | null }`
  - `interface PricedOfferLine { unitPrice: number; offerPercent: number; bonusQty: number; salesTax: number; salesTaxAmount: number; lineTotal: number }`
  - `priceOfferLine(rule: OfferRule, basePrice: number, quantity: number, tax: { salesTax: number; applicable: boolean }): PricedOfferLine`
  - `resolveSalesTax(batchTax: number | null, offerTax: number | null): number`

- [ ] **Step 1: Write failing tests** in `tests/pricing/offer-pricing.test.ts` (`node:test` + `assert`), each calling `priceOfferLine` with `basePrice` 100 unless stated:
  - `NONE, offer 5, qty 10` → `unitPrice 100, offerPercent 5, bonusQty 0, lineTotal 950`.
  - `BONUS min 10 free 2, qty 25` → `bonusQty 4, lineTotal 2500` (offer 0); `qty 9` → `bonusQty 0`; `qty 10` → `bonusQty 2`.
  - `EXTRA_PERCENT min 20 extra 3, offer 5`: `qty 19` → `offerPercent 5`; `qty 20` → `offerPercent 8, lineTotal 1840`.
  - `NET_PRICE net 80, qty 5` → `unitPrice 80, offerPercent 0, lineTotal 400`; with `min 20 extra 2`: `qty 19` → 80/0%; `qty 20` → `offerPercent 2, lineTotal 1568`.
  - NET_PRICE with `commentNetPrice null` → falls back to `basePrice`, no discount; BONUS with `commentMinOrderQty null` → `bonusQty 0`; EXTRA_PERCENT with null min → no extra; `minOrderQty 0` never divides by zero.
  - Tax: `{salesTax: 3, applicable: true}, qty 10` → `salesTax 3, salesTaxAmount 30`; `applicable false` → 0/0; bonus units add no tax.
  - `resolveSalesTax(null, 4) === 4`, `resolveSalesTax(2, 4) === 2`, `resolveSalesTax(null, null) === 0`.
- [ ] **Step 2: Run** `npx tsx --test tests/pricing/offer-pricing.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** both functions in `lib/utils/offer-pricing.ts`, rounding money to 2 dp with the same `round2` convention as `lib/portal/pricing.ts`. EXTRA_PERCENT adds `commentExtraPercent` to `offerPercent` (same definition as `formatOfferComment`/`isOfferAtLoss` in `lib/utils/offer-comment.ts`).
- [ ] **Step 4: Run** the test file — expect all PASS.
- [ ] **Step 5: Commit** `git add lib/utils/offer-pricing.ts tests/pricing/offer-pricing.test.ts && git commit -m "feat: shared offer-list pricing module"`.

### Task 2: Sales tax on the stock batch

**Files:**
- Modify: `prisma/schema.prisma` (add `salesTax Decimal? @db.Decimal(10, 2)` to `MedicineBatch`)
- Modify: `app/api/purchase-invoices/route.ts` (batch create at ~line 197), `app/api/purchase-invoices/[id]/route.ts` (batch update at ~line 142)
- Create: `scripts/backfill-batch-sales-tax.ts`

**Interfaces:**
- Produces: `MedicineBatch.salesTax: Decimal | null` — the per-unit sales tax paid at purchase, `null` for unknown/legacy.

- [ ] **Step 1: Row-count check** — a one-off node script reports counts of `MedicineBatch` and `PurchaseInvoiceItem` with `batchId` not null; record in the commit message. (Additive nullable column, no backup needed.)
- [ ] **Step 2: Add the column** to the schema; run `npx prisma db push` then `npx prisma generate`.
- [ ] **Step 3: Set `salesTax` on batch create** from the line's computed `salesTax` (0 for non-applicable medicines) in the purchase-invoice POST, and include it in the batch `update` in the admin edit path.
- [ ] **Step 4: Write `scripts/backfill-batch-sales-tax.ts`** — for each `PurchaseInvoiceItem` with a `batchId`, set `MedicineBatch.salesTax = item.salesTax` where the batch value is null; dry-run flag prints the count first. Run dry-run, then for real.
- [ ] **Step 5: Verify** `npx tsc --noEmit` passes and re-run the dry-run (expect 0 remaining).
- [ ] **Step 6: Commit** schema + routes + script.

### Task 3: Server-side wiring (portal pricing, active offer list, staff POST)

**Files:**
- Modify: `lib/portal/pricing.ts` (`ServerOfferItem`, `PortalOfferItem`, `toPublicItem`, `priceLine`, `PricedLine`), `lib/portal/offer-list.ts` (`loadOfferItems`), `lib/portal/order.ts` (`savePortalOrder` line data), `app/api/offer-list/active/route.ts`, `app/api/orders/route.ts` (POST validation of `bonusQty`)
- Test: `tests/portal/pricing.test.ts` (update existing expectations)

**Interfaces:**
- Consumes: `priceOfferLine`, `resolveSalesTax` (Task 1); `MedicineBatch.salesTax` (Task 2).
- Produces: `ServerOfferItem` gains `rule: OfferRule` and `salesTax` already resolved via `resolveSalesTax(fefo.salesTax, item.salesTax)`; `PortalOfferItem` gains `rule: OfferRule` (whitelisted: no cost/stock) and `salesTax: number` (0 when not applicable); `PricedLine` gains `bonusQty: number`; `GET /api/offer-list/active` items gain `fefoSalesTax: number | null` per medicine.

- [ ] **Step 1: Update `tests/portal/pricing.test.ts`** — add: a BONUS offer (min 10, free 2) priced at qty 25 returns `bonusQty 4`; a NET_PRICE offer with `min 20 extra 2` at qty 20 returns the discounted `lineTotal`; `toPublicItem` output contains `rule` and `salesTax` but no `mrp`/cost keys.
- [ ] **Step 2: Run** `npx tsx --test tests/portal/pricing.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** — `priceLine` delegates to `priceOfferLine`; `loadOfferItems` selects the FEFO batch's `salesTax` and the comment fields and builds `rule`; `savePortalOrder` writes `bonusQty` on each order item; `buildPricedLines` totals unchanged (`total` stays the product subtotal, excluding tax).
- [ ] **Step 4: Staff endpoints** — `GET /api/offer-list/active` additionally returns each item's FEFO batch `salesTax` (`fefoSalesTax`); `POST /api/orders` coerces `bonusQty` to an integer `>= 0` (400 otherwise).
- [ ] **Step 5: Run** the portal test suite plus `npx tsc --noEmit` — expect PASS.
- [ ] **Step 6: Commit.**

### Task 4: Stock deduction counts bonus units

**Files:**
- Modify: `app/api/orders/[id]/status/route.ts` (DELIVERED loop), `lib/orders/lifecycle.ts` (restock reads `deductedQty`, so verify only), `app/api/orders/[id]/route.ts` (admin edit of a DELIVERED order)
- Test: `tests/orders/bonus-deduction.test.ts`

**Interfaces:**
- Consumes: `deductFefo(tx, medicineId, qty)` and `unitCostFrom(costSum, qty)` from `lib/accounting/cost.ts`.
- Produces: for a delivered item, `deductedQty` = units actually removed, up to `quantity + bonusQty`.

- [ ] **Step 1: Write a failing test** `bonus line deducts quantity + bonusQty` that exercises the extracted pure helper `totalUnits(item: { quantity: number; bonusQty: number }): number` (create it in `lib/orders/units.ts`): `totalUnits({quantity: 25, bonusQty: 4}) === 29`; and `unitCost` uses the same total as divisor.
- [ ] **Step 2: Run** `npx tsx --test tests/orders/bonus-deduction.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `totalUnits` and use it in the DELIVERED loop for both `deductFefo` and `unitCostFrom`; in the admin edit of a delivered order, base the deduct/restock delta on `totalUnits` too (a manual `bonusQty` edit sticks until quantity changes).
- [ ] **Step 4: Run** the test and `npx tsc --noEmit` — expect PASS.
- [ ] **Step 5: Commit.**

### Task 5: Sales Invoice page applies the shared pricing

**Files:**
- Modify: `app/(erp)/orders/new/page.tsx` (line add at ~129, `updateLine` at ~145, submit payload at ~183), `app/(erp)/orders/[id]/page.tsx` (show `bonusQty` column)

**Interfaces:**
- Consumes: `priceOfferLine`, `OfferRule` (Task 1); `GET /api/offer-list/active` `fefoSalesTax` (Task 3).

- [ ] **Step 1: Add** `bonusQty` and the per-line `rule` to the line state. On adding a line or changing quantity, recompute via `priceOfferLine(rule, basePrice, quantity, tax)` and set `unitPrice`, `offerPercent`, `bonusQty`, `salesTax`. Tax is initialised from `resolveSalesTax(fefoSalesTax, offer.salesTax)` and stays editable; a manual edit of `unitPrice`/`offerPercent`/`salesTax`/`bonusQty` sticks until quantity next changes.
- [ ] **Step 2: Show** a "Free" column for `bonusQty` and a small hint under the quantity (e.g. "10 + 2: 4 free") from the shared module; include `bonusQty` in the POST payload.
- [ ] **Step 3: Verify manually** (dev server on :3100 per project convention): QA customer + QA medicine with a BONUS offer item — qty 25 shows 4 free; a Net item with MOQ shows the extra % at the MOQ. Clean up the QA records.
- [ ] **Step 4: Run** `npx tsc --noEmit`; **Commit.**

### Task 6: Shared order-status function and Deliveries board

**Files:**
- Create: `lib/orders/set-status.ts` (extract the whole body of `PUT` from `app/api/orders/[id]/status/route.ts`), `app/api/deliveries/bulk/route.ts`
- Modify: `app/api/orders/[id]/status/route.ts` (thin wrapper), `app/api/deliveries/[id]/route.ts`, `app/(erp)/deliveries/page.tsx` (replace with the board)
- Test: `tests/orders/set-status.test.ts`

**Interfaces:**
- Produces:
  - `setOrderStatus(id: string, status: string): Promise<{ order: Order; warnings: string[] }>` — exact current behaviour of the status route (tx, FEFO deduction, invoice/delivery/challan on CONFIRMED, `syncAllSafe`); throws `AccountingError` unchanged.
  - `PUT /api/deliveries/[id]` body `{ action: 'start' | 'deliver' | 'fail' | 'reschedule', scheduledDate?: string, driverId?: string | null, notes?: string }`: `start` → delivery `OUT_FOR_DELIVERY` and order `DISPATCHED` if earlier; `deliver` → `setOrderStatus(orderId, 'DELIVERED')`; `fail` → delivery `FAILED`; `reschedule` → `RESCHEDULED` with new `scheduledDate`, order unchanged. The route no longer writes `status: 'DELIVERED'` itself.
  - `PUT /api/deliveries/bulk` body `{ ids: string[]; driverId: string | null }` → `{ updated: number }`.

- [ ] **Step 1: Write failing tests** for pure helper `nextDeliveryColumn(status: string): 'TO_DISPATCH' | 'OUT' | 'DELIVERED'` in `lib/deliveries/columns.ts` (`SCHEDULED`/`RESCHEDULED`/`FAILED` → `TO_DISPATCH`, `OUT_FOR_DELIVERY` → `OUT`, `DELIVERED` → `DELIVERED`) and `deliveryMismatch(deliveryStatus: string, orderStatus: string): boolean` (true only for delivery `DELIVERED` with order not `DELIVERED`).
- [ ] **Step 2: Run** `npx tsx --test tests/orders/set-status.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** helpers, the `setOrderStatus` extraction (behaviour-preserving; the status route calls it), the new delivery route actions (idempotent: `deliver` on an already-DELIVERED order must not deduct again, which `setOrderStatus` already guarantees), and the bulk route (SALESMAN role is 403; `ADMIN`/`MANAGER` only).
- [ ] **Step 4: Replace the page** with a three-column board (To dispatch / Out for delivery / Delivered): cards show customer, area, amount, driver, a "order not marked delivered" warning when `deliveryMismatch`, and one button per state (Start, Delivered, Failed/Reschedule); multi-select cards + "Assign driver"; date defaults to the area-aware next delivery day (earliest `scheduledDate >= today` among existing deliveries, else today) with the date picker retained; one "Print" menu holds the existing area/driver/challans/manifest outputs. Keep the SALESMAN self-scope from `GET /api/deliveries`.
- [ ] **Step 5: Verify** on a QA order: confirm → Start → Delivered; the order shows DELIVERED and stock dropped once; tapping Delivered twice leaves stock unchanged. Report (do not fix) the count of existing Delivery=DELIVERED/Order≠DELIVERED rows via a read-only query. Clean up QA data.
- [ ] **Step 6: Run** `npx tsc --noEmit`; **Commit.**

### Task 7: Draft invoices

**Files:**
- Modify: `app/api/orders/route.ts` (POST accepts `status: 'DRAFT'`; GET status filter already generic), `app/(erp)/orders/new/page.tsx` (Save as draft button, `?draft=<id>` load), `app/(erp)/orders/page.tsx` (DRAFT badge/filter), `app/api/dashboard/stats/route.ts` and any other `prisma.order` counting/summing query found by `Grep "prisma.order"` under `app/api` (exclude DRAFT where they count sales/today's orders)
- Create: `app/api/orders/[id]/draft/route.ts`

**Interfaces:**
- Produces: `PUT /api/orders/[id]/draft` body = the same shape as `POST /api/orders` → replaces all lines on an order whose status is `DRAFT` (409 otherwise) and recomputes `totalAmount`; confirming a draft = existing `PUT /api/orders/[id]/status` with `PENDING` (then the normal flow).

- [ ] **Step 1: Write failing test** `tests/orders/draft-rules.test.ts` for pure helper `isDraftEditable(status: string): boolean` and `countsAsSale(status: string): boolean` in `lib/orders/draft.ts` (`DRAFT` → editable true, counts false; every other status → editable false; `CANCELLED` and `DRAFT` do not count as a sale).
- [ ] **Step 2: Run** the test — expect FAIL.
- [ ] **Step 3: Implement** helpers, POST draft support (no invoice/delivery/stock/accounting side effects; skip `syncSafe`), the draft PUT route, and the status route's PENDING transition from DRAFT. Exclude DRAFT in dashboard stats, reports counting orders, `/api/purchase-demand` (already status-listed, verify), portal open-order logic (already `PENDING` only, verify).
- [ ] **Step 4: UI** — "Save as draft" next to the existing submit; reopening `/orders/new?draft=<id>` loads lines for editing and shows "Confirm" which PUTs the draft then sets PENDING; the Orders list shows a grey DRAFT badge and the status filter gains DRAFT.
- [ ] **Step 5: Verify** with a QA draft: no Invoice/Delivery/stock change, absent from Deliveries and dashboard; confirm it and the normal flow works. Clean up.
- [ ] **Step 6: Run** `npx tsc --noEmit`; **Commit.**

### Task 8: Admin-only inventory delete

**Files:**
- Modify: `app/api/inventory/[id]/route.ts` (DELETE), `app/(erp)/inventory/[id]/page.tsx` (button, near the batch-delete at ~line 114)
- Test: `tests/inventory/delete-rules.test.ts`

**Interfaces:**
- Produces: `medicineDeleteBlockers(counts: { stockBatches: number; purchaseLines: number; orderLines: number; returnLines: number; offerListItems: number }): string[]` in `lib/inventory/delete-rules.ts` — empty when deletable.

- [ ] **Step 1: Write failing test:** all zeros → `[]`; `stockBatches: 1` → a non-empty message list; `offerListItems: 2` → non-empty; stock-0 unreferenced batches are not passed in as blockers (the route counts only batches with `currentQty > 0` or referenced by purchase/return lines).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** — in `DELETE`: if `getUserFromRequest(req).role === 'ADMIN'`: gather the counts, return `409 { error, blockers }` when blocked (UI offers "Deactivate" via the existing PUT with `isActive: false`), else delete unreferenced zero-stock batches and the medicine in one transaction (hard delete); for other roles keep the existing `handleDelete` path unchanged.
- [ ] **Step 4: UI** — Admin-only "Delete item" button with a confirm dialog; on 409 show the blockers and a "Deactivate instead" action.
- [ ] **Step 5: Verify** with a QA medicine: deletes cleanly when unreferenced; 409 when it has an offer-list item (QA data only). Clean up.
- [ ] **Step 6: Run** `npx tsc --noEmit`; **Commit.**

### Task 9: Offer list — Net display, MOQ extra, Sales Tax column, ST tag

**Files:**
- Modify: `lib/utils/offer-comment.ts` (`formatOfferComment`, `isOfferAtLoss`), `app/api/offer-list/[id]/route.ts` (GET adds `fefoSalesTax`; PUT persists `commentMinOrderQty`/`commentExtraPercent` for NET_PRICE), `app/(erp)/offer-list/[id]/page.tsx` (editor), `app/(erp)/offer-list/[id]/customers/[customerId]/page.tsx`, `app/api/offer-list/export/route.ts`, `app/api/offer-list/pdf/route.ts` + `components/offer-list/OfferListPDF.tsx`, `app/portal/(app)/page.tsx`
- Test: `tests/pricing/offer-comment.test.ts`

**Interfaces:**
- Produces: `formatOfferComment` renders NET_PRICE as `"245.0 Net"` or, with MOQ+extra, `"245.0 Net (min 20 → extra 2.0%)"`; `isOfferAtLoss` for NET_PRICE compares the net price reduced by the extra % (when MOQ+extra set) to purchase price.

- [ ] **Step 1: Write failing tests** `tests/pricing/offer-comment.test.ts`: the two NET_PRICE display strings above; `isOfferAtLoss` NET 100, extra 10 (MOQ set), purchase 95 → `true` (90 < 95); extra null → compares 100 vs 95 → `false`. Existing strings for NONE/EXPIRY/BONUS/EXTRA_PERCENT unchanged.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the two formatting/loss changes.
- [ ] **Step 4: Editor** — for Comments = Net Price reveal MOQ and Extra % inputs (same inline style as the Bonus inputs); add a read-only **Sales Tax** column (Rs/unit from `fefoSalesTax`, `—` when the medicine is not Sales Tax Applicable) and a small "ST" tag beside the medicine name when tax > 0. HTML export and the per-customer sheet get the same Sales Tax column + tag (PDF stays 3-column per the existing dense layout — add only the tag if it fits, builder's call).
- [ ] **Step 5: Customer surfaces** — the portal list, HTML export, PDF and customer sheet render a blank T.P. cell for `commentType === 'NET_PRICE'`; the Comments column shows the net-price string. Staff editor keeps T.P.
- [ ] **Step 6: Run** the test file and `npx tsc --noEmit`; **Commit.**

### Task 10: Portal estimate, tax line and Enter-key navigation

**Files:**
- Modify: `app/portal/(app)/page.tsx` (estimate, search and quantity inputs), `app/(erp)/offer-list/[id]/page.tsx` (editor Enter handling)
- Create: `lib/ui/grid-enter.ts`

**Interfaces:**
- Consumes: `PortalOfferItem.rule`, `PortalOfferItem.salesTax` (Task 3); `priceOfferLine` (Task 1).
- Produces: `nextGridCell(cells: HTMLElement[][], row: number, col: number): HTMLElement | null` — next editable cell to the right, else first cell of the next row, else `null`.

- [ ] **Step 1: Write failing test** `tests/ui/grid-enter.test.ts` (plain objects stand in for elements; guard type with a generic): middle of a row → next column; last column → first column of next row; last cell of the last row → `null`.
- [ ] **Step 2: Run** `npx tsx --test tests/ui/grid-enter.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `nextGridCell` and wire it into the Offer List editor's `onKeyDown` (Enter on Offer %, Comments inputs, T.P.; Radix selects untouched, matching `EnterKeyNavigation`'s existing exclusion).
- [ ] **Step 4: Portal** — the estimate recomputes each line with `priceOfferLine` using the item's `rule`/`salesTax` and shows **Subtotal**, **Sales tax**, **Estimated total**; show free units where `bonusQty > 0`. Pressing Enter in the item search focuses that row's quantity input (selecting the top match first if none is focused); Enter in quantity returns focus to search.
- [ ] **Step 5: Verify** manually in the portal with a QA customer: tax line present, bonus shown at the MOQ, keyboard-only entry works. Clean up QA data.
- [ ] **Step 6: Commit.**

### Task 11: Final verification

- [ ] **Step 1:** `npx tsx --test tests/pricing/*.test.ts tests/portal/pricing.test.ts tests/orders/*.test.ts tests/inventory/*.test.ts tests/ui/*.test.ts` — all pass.
- [ ] **Step 2:** `npx tsc --noEmit` and `npx next build` — both succeed.
- [ ] **Step 3:** Confirm no `QA ` records remain (`SELECT` scoped to `name LIKE 'QA %'` across retailers, medicines, orders, suppliers) and report the Delivery/Order mismatch count to the owner. Do not push; hand back for review.
