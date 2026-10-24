# Client Feedback Round (2026-10-24) — Design

## Intent
The client is using the live ERP and reported nine issues. Two root problems sit behind most of them:
1. **Offer-list Comment discounts (Bonus, Extra %, Net Price) are display-only.** No pricing code reads `commentType`, so neither the Sales Invoice nor the Customer Portal applies them. Sales tax also isn't tied to what was paid at purchase.
2. **Deliveries has two disconnected status systems.** The Deliveries page's "Delivered" button updates only `Delivery.status`; the order stays CONFIRMED and stock is not deducted (that happens only in `PUT /api/orders/[id]/status`).

Success: an invoice (staff or portal) equals what the offer list promised; tax flows from purchase to sale; staff move a delivery with one action and the order/stock follow; the smaller UX asks are done.

## Goals
- One shared pricing function used by Sales Invoice, Portal estimate/order, and anything else pricing an offer-list line.
- Sales tax sourced from the stock batch (originating in the Purchase Invoice).
- Simplified Deliveries board where status changes cannot drift from order status.
- Draft invoices, Admin-only inventory delete, Enter-key navigation, Net-item customer display, MOQ extra %.

## Non-goals / anti-goals
- No change to Purchase Invoice math, accounting postings, or tax formulas for purchasing.
- Do not break existing confirmed invoices/ledger. No retroactive repricing of existing orders.
- Do not expose cost, Purchase %, or stock to customers (portal whitelist rules stay).
- Staff users must not lose the ability to see T.P. on Net items.
- No weakening of existing role enforcement; no new approval flows.

## Constraints
- **Production DB, no staging.** Schema changes must be additive; check row counts first (see CLAUDE.md "Development & Deployment Reality"). `git push` redeploys immediately; run `next build` first.
- Reuse `lib/utils/pricing.ts`, `lib/utils/offer-comment.ts`. Don't reimplement math inline.
- QA with `QA `-prefixed records only; clean up. Do NOT run qa-offer/qa-orders scripts against production (they add a QA item to the live offer list).
- Pakistan timezone for date logic. All money `Decimal`.

## Decisions made with the client (as they decided them)
- **Bonus** ("10 + 2"): adds **free units**, **2 free per full 10** ordered (25 → 4 free). Free units are deducted from stock, are stored in `OrderItem.bonusQty`, and do not change the line total.
- **Sales-tax carry-forward** means the **purchase invoice's tax** (flat Rs/unit) flows forward to the sale and the offer list.
- **Net-item MOQ extra:** a Net item may carry a minimum order quantity; at or above it, an **extra percent off the net price** applies.
- **Deliveries layout: three-column board** — To dispatch → Out for delivery → Delivered.
- **Draft invoice:** staff save an unconfirmed Sales Invoice, return later, edit and confirm.
- **Inventory delete:** **Admin only**, no approval step.

## Design

### 1. Shared offer pricing (fixes #6, enables #4/#7/#9)
Create one pure module (e.g. `lib/utils/offer-pricing.ts`) taking an offer item (offerPercent, specialPrice, commentType and its fields, salesTax), the FEFO price, and a quantity, returning `{ unitPrice, offerPercent, bonusQty, salesTax, salesTaxAmount, lineTotal }`.
- NONE / EXPIRY: `unitPrice`, `offerPercent` as today.
- BONUS: `bonusQty = floor(qty / commentMinOrderQty) * commentQtyFree`; price unchanged. Free units deduct from stock at delivery.
- EXTRA_PERCENT: additional discount per the formula already in `formatOfferComment`/`isOfferAtLoss` (builder: match that definition exactly; apply only at/above `commentMinOrderQty` if one is set).
- NET_PRICE: `unitPrice = commentNetPrice`, `offerPercent = 0`; if MOQ and extra % are set and `qty >= MOQ`, apply the extra % off the net price.
- Used by: `orders/new` page (live recompute on qty change; fields stay editable by staff), `lib/portal/pricing.ts` (`priceLine`), and the portal cart estimate. Server-side recompute in the portal remains authoritative.
- `GET /api/offer-list/active` and the portal offer endpoint must pass the comment fields needed (portal gets only whitelisted fields).
- Stock: the DELIVERED FEFO deduction must deduct `quantity + bonusQty`. Builder to verify current behaviour and fix if bonusQty is ignored.

### 2. Sales tax carry-forward (#7, #5/#6 display)
- **Additive schema change:** `MedicineBatch.salesTax Decimal? @db.Decimal(10,2)`, set from `PurchaseInvoiceItem.salesTax` when a purchase invoice creates the batch, and updated by the admin purchase-invoice edit path. Existing batches stay null (backfill from their linked `PurchaseInvoiceItem` via `batchId` where available — one-off script, row counts first).
- Sales tax for a line = FEFO batch's `salesTax` (only if `Medicine.salesTaxApplicable`), editable on the invoice as today. The offer list's own stored `OfferListItem.salesTax` is superseded for display/auto-fill; the builder decides whether to keep the column unused or stop reading it.
- Offer list editor, HTML export and customer sheet show a **Sales Tax** value column; items with tax get a small "ST" tag.
- Portal estimate includes sales tax (`Σ salesTaxAmount`) and shows it as a separate line from the product subtotal.

### 3. Net items for customers (#4, #9)
- Customer-facing surfaces (portal list, HTML export, PDF, customer sheet) do not show a separate T.P. for NET_PRICE items; the net price is shown instead (as the price, via the comment). Staff views keep T.P.
- New optional offer-list inputs for NET_PRICE: MOQ and extra % (reuse `commentMinOrderQty` and `commentExtraPercent`; additive schema change only if those can't be reused cleanly). `formatOfferComment` shows e.g. "245.0 Net (min 20 → extra 2%)". Loss flag (`isOfferAtLoss`) must account for the extra %.

### 4. Deliveries board (#8)
- Replace the Deliveries page with a three-column board: To dispatch (SCHEDULED), Out for delivery, Delivered. Date defaults to the next delivery day; a date picker stays.
- One action per card:
  - Start → sets delivery OUT_FOR_DELIVERY and the order DISPATCHED (if earlier).
  - Delivered → calls the same code path as `PUT /api/orders/[id]/status` DELIVERED so stock deduction, COGS sync and `deliveredAt` stay in one place. The delivery route must not set DELIVERED on its own anymore.
  - Failed (red tag) + Reschedule.
- Bulk driver assignment (multi-select cards → pick driver). Salesman role still sees only their own (server-side scope unchanged).
- PDFs (area/driver/challans/manifest) collapse into one "Print" menu; endpoints unchanged.
- Existing mismatch rows (Delivery DELIVERED but Order CONFIRMED) must be listed for the builder/owner; do not auto-fix stock silently — report the count and ask before backfilling.

### 5. Draft invoices (#1)
- Sales Invoice creation gets "Save as draft" next to confirm. A draft is an `Order` with a new status `DRAFT` (plain String; additive, no schema change): no invoice, delivery, challan, stock, or ledger effect, excluded from deliveries, aging and portal "open order" logic.
- Drafts appear in the Orders list (filterable), are editable via the creation form, and "Confirm" moves DRAFT → PENDING/CONFIRMED through the normal path. Delete of a draft follows existing order delete rules.

### 6. Inventory delete (#2)
- `DELETE /api/inventory/[id]` for ADMIN only (403 otherwise; no DeleteApproval). Allowed only when the medicine has no batches, purchase/order/return lines or offer-list items; otherwise respond 409 with a clear message and offer "Deactivate" (`isActive=false`). UI button on the inventory detail page (Admin-only).

### 7. Enter-key navigation (#3, #10)
- Offer list editor: Enter moves to the next editable cell in the row, then the first editable cell of the next row. `EnterKeyNavigation.tsx` deliberately skips selects; the editor needs its own handler covering Offer %, the Comments select/inputs, and T.P.
- Portal: Enter in the item search focuses that item's quantity input; Enter in quantity returns focus to search.

## Calls made by the designer (not yet confirmed by the client — review these)
1. **Bonus threshold and tax.** The threshold counts the **paid** quantity only (free units never count toward it). Sales tax applies to the **paid** quantity only (`salesTax × quantity`); free units carry no tax. Bonus recomputes whenever staff change the quantity; a manual `bonusQty` edit sticks until the quantity next changes.
2. **Delivery/Order mismatch rows.** Cards whose delivery is DELIVERED but whose order is not show normally with a "order not marked delivered" warning. No automatic backfill; after the board ships, report the count to the owner and backfill only on their say-so. The board can ship independently of that backfill.
3. **Tax source stability.** Tax is locked on the line at invoice creation from the FEFO batch chosen then, and is not re-derived later. A batch with null `salesTax` falls back to `OfferListItem.salesTax`, then 0. Existing invoices are never repriced, so the legacy offer-list column is read as a fallback and is not dropped.
4. **Comment types.** An item has exactly one `commentType`, so Bonus and Net MOQ never coexist. `commentMinOrderQty` is the MOQ for Bonus, Extra % and Net; `commentExtraPercent` is the extra % for Extra % and Net. The builder reads `offer-comment.ts` for the exact Extra % formula and matches it.
5. **Drafts.** A draft checks no stock and no credit limit. The credit warning runs at confirm. Confirming a draft creates a normal PENDING order and then follows the normal confirm path. Drafts are excluded from customer outstanding, the dashboard, deliveries, aging and portal open-order logic. Any role that can create a Sales Invoice can save a draft.
6. **Net display.** On customer surfaces the T.P. cell is blank for NET_PRICE items and the Comments column shows the net price ("245.0 Net"). Customer surfaces are the portal, the HTML and PDF exports, and the per-customer quantity sheet. The portal estimate still prices the line at the net price. Staff views keep T.P.
7. **Inventory delete.** Blocked if any batch has stock, or if any purchase, order, return or offer-list line references the medicine. Zero-stock batches nothing references are removed with it. The existing MANAGER approval path for Medicine stays as is.

## Left to the builder
Exact module/file names; the EXTRA_PERCENT/EXPIRY details beyond matching existing display formulas; migration/backfill script mechanics; board visual polish; whether to keep `OfferListItem.salesTax` column.

## Build order
1) offer-pricing module + tax on batch (+tests) → 2) Sales Invoice and portal wiring → 3) Net-item display and MOQ extra → 4) Deliveries board → 5) Drafts + inventory delete → 6) Enter-key navigation. Each step verified before the next; build before push.

## Testing
Unit tests for the pricing module (bonus floor, net, MOQ boundaries, tax). Integration QA only with `QA ` records and cleanup; no qa-offer/qa-orders against production.
