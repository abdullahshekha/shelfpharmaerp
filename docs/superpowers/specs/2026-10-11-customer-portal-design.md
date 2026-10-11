# Customer Portal — Design Spec

Date: 2026-10-11 · Status: design approved in chat; written spec pending review · Phase 5 of the ShelfPharma change request (item 8)

## Goal

Let customers (UI "Customer" = model `Retailer`) log in to a portal, see their area's delivery days, browse the Offer List for their Customer Type, enter quantities and place an order that staff review. Orders land as PENDING with source `OFFER_LIST` and flow through the existing confirm → invoice → delivery → challan pipeline unchanged.

## Key constraint (security)

Staff sessions (`sp_session`) are trusted by the whole ERP: `middleware.ts` only checks the cookie exists, and almost no API route checks the role. A customer holding a staff-style session could call any ERP API. Therefore customers get a **separate session** and never receive `sp_session`.

**Pre-existing hole found during implementation (user-approved fix, in scope):** `middleware.ts` only checked that an `sp_session` cookie *existed*, so any value (`sp_session=garbage`) passed and most API routes served data. The middleware now verifies the cookie's HMAC signature and payload shape. Portal tokens use a derived signing key so they can never validate as staff sessions.

## Architecture

- **Cookie:** `sp_customer`, HMAC-signed with `AUTH_SECRET` (same scheme as `lib/utils/auth.ts`), payload `{ rid, v, iat }` (`rid` = retailer id, `v` = `portalSessionVersion`), 7-day max age, httpOnly, sameSite lax.
- **Pages:** `app/portal/login/page.tsx`, `app/portal/(app)/layout.tsx` (server component: verifies cookie + loads customer, redirects to `/portal/login`), `app/portal/(app)/page.tsx` (Order tab) and `app/portal/(app)/orders/page.tsx` (My Orders tab). Outside the `(erp)` group, so the staff shell/sidebar is never rendered for customers.
- **APIs:** all under `/api/portal/*`. `middleware.ts` exempts `/api/portal/` from the `sp_session` presence check (like `/api/auth/login`); each portal route authenticates via `getCustomerFromRequest(req)` itself. The customer id is **only** ever taken from the session, never from body/query.
- **Every request** re-loads the retailer and rejects (401) if `isActive` is false, `portalEnabled` is false, or the cookie `v` ≠ `portalSessionVersion`.
- ERP APIs return 401 to customers automatically (no `sp_session`).

## Schema (additive, on `Retailer`)

```
portalUsername        String?   @unique
portalPasswordHash    String?             // scrypt: "salt:hash" hex
portalEnabled         Boolean   @default(false)
portalSessionVersion  Int       @default(0)   // bump on password reset / disable → invalidates cookies
portalFailedAttempts  Int       @default(0)
portalLockedUntil     DateTime?
portalLastLoginAt     DateTime?
```

No existing columns change. Row counts are checked before `db push` per the production DB protocol.

## Credentials & access management

- Staff (ADMIN, MANAGER — enforced server-side) manage access from a **"Portal access"** card on the customer detail page: set username, set/reset password, enable/disable. Customers **cannot** change their own password.
- Username: lowercase, trimmed, 3–32 chars of `[a-z0-9._-]`, unique across customers; also rejected if it equals an Employee username or the env admin username (avoid ambiguity).
- Password: min 8 chars; hashed with scrypt + random per-user salt (`lib/utils/portal-auth.ts`), compared with `timingSafeEqual`.
- Reset password or disable → `portalSessionVersion++`, clears lockout.
- `POST /api/portal/login`: generic "Invalid username or password" for unknown user / wrong password / disabled / inactive (no account enumeration). 5 consecutive failures → `portalLockedUntil = now + 15 min` (returns 429 "Too many attempts, try again later"); success resets the counter.
- `POST /api/portal/logout` clears the cookie.

## What the customer sees

**Header card:** customer name; **Delivery days** chips from `area.deliveryDays` (e.g. Monday, Tuesday); beneath it the next booking cut-off derived from `area.bookingDays` (e.g. "Order by Sunday 5:00 PM"). Either section is hidden when the area has none set.

**Order tab — Offer List:**
- Resolved list: the active `OfferList` (`isActive`) for which the customer has an `OfferListCustomer` sheet, else one whose `OfferListAssignment.customerType` equals the customer's type. None → "No offer list is available for you right now."
- Rows grouped by manufacturer: Code, Item, T.P., Offer %, Comment (`formatOfferComment`), quantity input. T.P. = `specialPrice ?? FEFO batch tradePrice` (same as staff). Items with no price are hidden.
- Search box (name / generic / code, client-side filter) over the loaded list.
- **Never returned by the portal API:** `purchasePercent`, `purchasePrice`, stock counts, loss flags. Explicit field whitelist in `GET /api/portal/offer-list`.
- Floating bottom button **"Place Order · N items · Rs X"** (or "Update Order" when an open order exists), disabled when nothing changed/empty.
- Line total = `qty × T.P × (1 − Offer%)`, excluding sales tax (same as `POST /api/orders`).

**My Orders tab:** the customer's orders (newest first): number, date, status, total, lines, and scheduled delivery date once confirmed. Cancelled orders are shown as cancelled.

## Ordering rules

- The customer's **open order** = their PENDING order with `source = 'OFFER_LIST'` (most recent). Staff-created PENDING orders are never read or modified by the portal.
- `GET /api/portal/order` returns the open order (or null); the offer list pre-fills quantities from it.
- `PUT /api/portal/order` body `{ orderId: string | null, items: [{ medicineId, quantity }] }`:
  - Quantities are whole numbers 0–9999; 0 / omitted removes the line. At least one line > 0 is required (empty cart → 400; to drop everything the customer sets lines to 0 and the order is deleted if still PENDING and now empty… see below).
  - Each `medicineId` must be on the customer's resolved offer list, else 400.
  - Prices are computed **server-side** from the offer list/FEFO batch (client prices ignored): `unitPrice`, `offerPercent`, `salesTax` (only if `medicine.salesTaxApplicable`), `salesTaxAmount`, `mrp` snapshot from the FEFO batch, `lineTotal`.
  - `orderId: null` and no open order → create new PENDING order (`generateOrderNumber`, `source 'OFFER_LIST'`, `salesRepId` = customer's assigned booker). `orderId` set → must equal the current open order **and still be PENDING**; otherwise **409** `"Your order was confirmed by our team — your changes were not saved"` and the client reloads.
  - Update = replace all lines in one transaction (delete old items, create new, recompute `totalAmount`).
  - Cleared cart on an existing open order = the order is deleted (it is PENDING and portal-created, so no invoice/delivery exists) → returns `{ data: null }`.
- Staff confirmation (`PUT /api/orders/[id]/status`) is untouched and remains the only way an order leaves PENDING; after that the next Place Order starts a fresh order.
- No credit-limit warning, no minimum order (per earlier decision).

## Admin visibility

Portal orders appear in the normal Orders list with Source = Offer List. No new staff screens besides the Portal access card.

## Out of scope

Self-registration, customer password change/forgot-password, online payment, invoice/challan download for customers, staff notifications (push/WhatsApp), customer cancellation of confirmed orders, stock display.

## Testing

`tsc` + `npm run build`. API tests against production with `QA ` prefixed records, cleaned up afterwards:
1. Login: success, wrong password, unknown user, disabled, inactive customer, lockout after 5 failures, session-version invalidation after reset.
2. A customer cookie gets 401 on staff APIs (`/api/retailers`, `/api/invoices`); a staff cookie gets 401 on `/api/portal/*`.
3. Portal offer list resolves by assignment and by individual override; response contains no cost/stock fields.
4. Place order → PENDING/`OFFER_LIST`, correct totals; update merges into the same order; remove line; clear cart deletes; confirmed-order conflict returns 409 and next order is new; staff PENDING order untouched; foreign `medicineId` rejected.
5. Staff-only management of portal credentials (403 for other roles).
6. Customer detail "Portal access" card and portal pages return 200.
