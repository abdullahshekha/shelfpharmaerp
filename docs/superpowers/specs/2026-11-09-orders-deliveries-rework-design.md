# Orders / Deliveries Rework — Design

Date: 2026-11-09. Part 3 of 3 (1: audit log, 2: PDC cheque management — both shipped and relied on here).

## Intent and why

The client wants the sales order flow to match how deliveries really happen: goods leave the warehouse when a delivery is assigned, the person delivering records what actually happened at the customer's door (paid in full, paid with a return, returned, put on hold, or delivered on credit), and a manager or admin confirms the cash/cheques and the returned stock that come back. Today the order flow is Pending > Confirmed > Picking > Dispatched > Delivered and stock only leaves at Delivered; the delivery board has three columns and no outcomes.

## Goals

- **New order statuses**, replacing the old ones: **Order Received**, **Invoice Generated**, **Out for Delivery**, then the actual result **Delivered / On Hold / Returned**. (Cancelled stays.) **Draft and Picking are removed.**
- **Delivery board with 5 columns:** Ready to Dispatch, Delivery Assigned, Delivered, Returned, On Hold.
- **Assignment:** a delivery can be assigned to a Driver, Salesman, Booker or Team Lead. **Assigning = Out for Delivery.**
- **Moving a delivery from Delivery Assigned to an outcome** can be done by a manager/admin, or by the user the delivery is assigned to (only their own deliveries). Five outcomes:
  1. **Paid in Full** — Cash, Bank or Cheque.
  2. **Paid with Return** — some line items/quantities returned (optional reason per line); the amount to collect is the order total minus the returned lines, then collected like Paid in Full.
  3. **Returned** — whole order returned; reason required.
  4. **On Hold** — reason required and the date to deliver next.
  5. **Delivered, Pay Later** — delivered, nothing collected, the customer owes it.
- **Reasons** (pick-lists): Returned / returned lines: no cash, not required, wrong order, late (returned-line reason optional). On Hold: no cash, shop closed.
- **Payment details:** Cash needs a choice of Cash or Bank (bank = an account from the Chart of Accounts) and a **picture**. Cheque takes a picture and the cheque details and becomes a Pending cheque in the existing PDC module (oldest-invoice-first rule applies when it clears). Cash/Bank amount is auto-filled from the order (total, or total minus returned lines).
- **Acknowledgement by manager/admin** of (a) every cash/bank collection and (b) every returned stock receipt.
- **Logins for all delivery roles:** Drivers, Bookers and Team Leads get ERP logins and a **My Deliveries** screen (the Salesman already has Deliveries); each sees only their own assigned deliveries and can record outcomes for them.
- **Every change is audit-logged** (already automatic through the audit log project). Admin-only viewing (order History panel + Audit Log page) is unchanged.
- **Old data is dummy and is converted** to the new statuses.

## Non-goals

- No change to how prices, tax or offer lists work.
- No route optimisation, GPS tracking or proof-of-delivery signature.
- No retry flow for a Returned order (a Returned order is final; "On Hold" is the only reschedule path). Confirmed with the client.
- No change to the customer portal ordering flow beyond the renamed statuses.

## Anti-goals

- Stock going out twice (On Hold then re-assigned) or coming back twice.
- Money recorded as received before a manager/admin acknowledges it.
- Returned stock added back to inventory before a manager/admin acknowledges it.
- A user changing or even seeing deliveries that are not assigned to them.
- Old/derived records disagreeing (an order saying Delivered while its delivery says otherwise).

## Decisions made with the client

- **Collected amount is fixed.** Paid in Full takes exactly the amount due (order total, or total minus returned lines); it cannot be edited. A customer who pays less is recorded as **Delivered, Pay Later** and the cash is collected later through the normal payment screen. No "partly paid" outcome exists.

- **Stock:** leaves inventory as soon as the delivery is marked Out for Delivery (assigned). If the order comes back **Returned** the stock is restored, but the movement history is kept. **On Hold: stock does NOT return to inventory.**
- **Ledger — option (a):** the sales invoice is posted to the customer's account when it is generated (as today). A fully **Returned** order **reverses the invoice** in the ledger; **Paid with Return** reverses only the returned lines through a **sales return**, so the customer's balance and ledger update. The customer's balance therefore includes orders still out for delivery.
- **Returned stock goes back to inventory only after a manager/admin acknowledges** it reached the warehouse.
- **On Hold:** the order is moved to the new date and on that date reappears simply as **Ready to Dispatch**.
- **Cash/Bank:** the customer's balance drops **only after a manager/admin acknowledges** the collection.
- **Returned is final**; **On Hold** can be rescheduled again.
- **Who assigns:** manager/admin (as today). Who completes: the assignee or a manager/admin.
- Delivery roles (Driver, Booker, Team Lead) all get logins and My Deliveries.

## Constraints

- Production database, no staging; mostly dummy old orders but check real row counts first (CLAUDE.md rules). Schema changes additive where possible; converting status strings needs a one-off migration script and a backup first.
- Builds on: audited Prisma client (never array-form `$transaction`), accounting sync (`lib/accounting/sync.ts`, builders for INVOICE, DELIVERY_COGS, SALES_RETURN), PDC module (`lib/pdc/*`), `lib/orders/set-status.ts` (all order side effects live there today), `lib/orders/lifecycle.ts` (cancel / hard delete / un-deliver restock rules), Supabase Storage for pictures (`retailer-photos` bucket pattern, `app/api/retailers/upload-photo`).
- Accounting lock/go-live rules still apply to anything that posts (a return/reversal in a locked period is refused, not forced).
- Roles are enforced server-side for the new endpoints; assignees see only their own deliveries (same pattern as the existing Salesman scoping).
- Karachi timezone; money Decimal, paisa in logic.

## Calls made by the assistant (not client decisions — please check)

1. **Status values:** Order.status becomes `RECEIVED | INVOICED | OUT_FOR_DELIVERY | DELIVERED | ON_HOLD | RETURNED | CANCELLED`. Mapping of old data: PENDING > RECEIVED, CONFIRMED and PICKING > INVOICED, DISPATCHED > OUT_FOR_DELIVERY, DELIVERED stays, DRAFT > deleted if empty/dummy, else RECEIVED.
2. **Board columns are derived:** Ready to Dispatch = INVOICED (and ON_HOLD whose new date has arrived); Delivery Assigned = OUT_FOR_DELIVERY; Delivered; Returned; On Hold = ON_HOLD with a future date.
3. **Stock deduction** happens in one place when an assignment is made, using the existing `deductedQty` so a re-assignment after On Hold never deducts again; un-assigning before an outcome restores the stock (manager/admin only). COGS is posted at the same moment.
4. **Cash/Bank collection** is stored as a separate "collection" record (amount, method, bank account, picture, collected by, acknowledged by/at); the ordinary `Payment` row (and so the ledger) is created only when a manager/admin acknowledges it. The payment applies to **this order's invoice** (not oldest-first); cheques keep the PDC oldest-first rule.
5. **Paid with Return:** a Sales Return is created at delivery time with the returned lines flagged "not yet restocked"; acknowledging the returned stock sets the lines restocked and adds stock to the FEFO batch. The collected amount is order total minus returned lines.
6. **Returned (whole order):** the invoice is reversed in the ledger at delivery time; stock stays out until the warehouse acknowledgement restores it.
7. **Acknowledgement screens:** two lists (collections to acknowledge, returned stock to acknowledge) for manager/admin; a manager/admin who records an outcome themselves still goes through the same acknowledge step (no self-skip) unless the builder finds this impractical.
8. **My Deliveries** is a new page showing only the logged-in user's assigned deliveries with the outcome dialog; Driver/Booker/Team Lead need ERP logins (HR already has login fields) and a nav entry that lists only this page for them.
9. **Cancel / hard delete** of an order in the new statuses reuses the existing lifecycle rules; a delivered order with an acknowledged collection cannot be hard-deleted (same as cheque-paid orders).

## Further calls made after the builder check (assistant's calls)

10. **"Invoice reversal" = a Sales Return.** A fully Returned order creates a Sales Return for all its lines; Paid with Return creates one for the returned lines. This credits the customer (Dr Sales returns / Cr AR) through the existing machinery, so customer outstanding (`invoices − return credits`) is correct without voiding the invoice. The restock entry (Dr Inventory / Cr COGS) posts when the returned stock is acknowledged and the lines are flagged restocked.
11. **COGS keys off stock leaving, not the DELIVERED status:** the DELIVERY_COGS posting is triggered by the delivery being assigned (deductedQty set) and dated that day.
12. **Cheque at the door:** the collector enters cheque number, amount, cheque date, optional bank and a picture; a Pending cheque is created immediately in the PDC module, marked unacknowledged (the PDC acknowledgement step already exists and is the manager/admin acknowledgement for cheques). Cash/Bank collections use their own acknowledge list.
13. **Order.status is the source of truth.** `Delivery` keeps `driverId` (any of the four roles) and `scheduledDate` (the On Hold new date is stored there); `Delivery.status` is kept in step by the one status function, never edited independently.
14. **Roles:** My Deliveries is added on top of each role's existing access (a Booker keeps Add Customer, a Team Lead keeps Dashboard/Inventory/Customers/Orders/Invoices); the nav shows it as one more entry. Drivers get only My Deliveries.
15. **Bulk assignment / short stock:** assignment is refused for an order whose stock is short (reported per order; the rest of the batch still goes through). Reassigning to another person while Out for Delivery changes only the driver, never stock.
16. **Acknowledgement:** a manager/admin may acknowledge any entry including ones they recorded themselves (the audit log records who). There is no rejection state in this project.
17. **Pay Later** is available for every customer; the existing credit-limit warning stays informational, nothing blocks it.
18. **Open-order flow:** Order Received to Invoice Generated stays a manual manager/admin action (today's "Confirm"), which still creates the invoice, delivery and challan. The portal's open order is a RECEIVED order with source OFFER_LIST. Draft invoices are removed; existing drafts are deleted (they have no stock, ledger or delivery effect).
19. **Existing data:** the builder checks real row counts first; any order already DELIVERED keeps its stock as deducted (the existing `deductedQty`, null = ordered quantity, rule still applies) so nothing deducts twice; a backup is taken before the status conversion.

## Left to the builder

Exact column/table names; migration script details and the backup step; how the My Deliveries nav and role scoping slot into `lib/nav.ts` and middleware; the layout of the outcome dialog and acknowledgement screens; how the old `PICKING`/`DRAFT` code paths (draft invoices, `PUT /api/orders/[id]/draft`, portal order status) are removed or adapted; how portal and dashboard/report queries that filter by old status values are updated; the split of this work into tasks.

## Success

A manager assigns a delivery to a driver and stock leaves inventory; the driver (logged in) opens My Deliveries, records Paid in Full by cash with a picture; the customer's balance stays unchanged until a manager acknowledges, then drops. A driver records Paid with Return for two lines: the sales return and invoice reversal appear in the ledger, stock returns only after the manager acknowledges it. On Hold keeps the stock out and the order reappears Ready to Dispatch on the chosen date. Every step shows in the order's History panel and the Trial Balance stays balanced.
