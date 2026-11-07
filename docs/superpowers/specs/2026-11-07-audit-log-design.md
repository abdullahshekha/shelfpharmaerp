# Audit Log — Design

Date: 2026-11-07. Part 1 of 3 (then PDC management, then Orders/Deliveries rework — see "Context").

## Intent and why

The client wants every change made anywhere in the ERP to be traceable: who changed what, when, and from what to what. The business reason is accountability for money- and stock-affecting actions (payments, returns, deliveries, edits to invoices), and the next two projects (cheque management, delivery outcomes) require a trustworthy trail to hang acknowledgments and approvals on. "All the audit logs must be made for each and every change" and, on scope: "every edit across the app".

## Context

Three projects, built in this order, each with its own design/plan:
1. **Audit log (this document).**
2. Post Dated Cheque (PDC) management — receivable (Sales) and payable (Purchase) cheques, statuses Pending / Stopped / Returned / Cleared, linked to a bank account from the Chart of Accounts.
3. Orders/Deliveries rework — new order statuses, 5-column delivery board, five delivery outcomes, Manager/Admin acknowledgments.

Both later projects write to the audit log and rely on it. Nothing in them is designed here.

## Goals

- Every create, update and delete on any table is recorded automatically, with no per-route logging code, so routes added later are covered without extra work.
- Each entry: who (employee id, name, role — or customer for portal actions, or "system/script"), when, table, record id, action, and the old and new values of only the fields that changed (creates store the new values, deletes store the old values). A free-text `reason` when the calling code supplies one.
- Logins and failed logins are recorded.
- Admin-only viewing: a **History** panel on each order (and its invoice/delivery/payments) and an **Audit Log** page with filters (user, date range, table, action) and search by order/invoice number or record id.
- Entries are append-only: the app offers no way to edit or delete them.

## Non-goals

- Reads are not logged.
- Changes made outside the app (Prisma Studio, raw SQL, one-off scripts) are not captured, except that script writes through the Prisma client are recorded with actor "script".
- No retention/archival policy now (keep everything).
- No alerts or notifications from the audit log.
- Not a way to undo changes.

## Anti-goals (failure even if it "works")

- The Audit Log page buried in noise from automatic ledger postings.
- A change that succeeds with no log entry (see "Failure behaviour").
- Secrets (password hashes, portal hashes) appearing in log values.
- Visible slowdown of list pages or bulk actions.

## Decisions made with the client

- **Scope:** every create/edit/delete across the app, plus logins.
- **Auto-posted ledger rows are skipped.** Journal entries/lines created by the accounting sync engine (`lib/accounting/sync.ts`) are not logged; they trace back to a logged source record (invoice, payment, return…). **Manually posted journals and opening-balance entries are logged.**
- **Failure behaviour:** the change fails too. A business write and its audit entry succeed or fail together.
- **Visibility:** Admin only (order History panel and the Audit Log page). Not Manager.
- **Bulk operations** (e.g. offer-list "assign to customer type" creating hundreds of rows) are logged as **one** entry with a count and the affected ids, not one row each. (Assistant's proposal, client has not objected.)

## Constraints

- Production database, no staging: purely additive schema (new `AuditLog` table only); check nothing else changes. Test with `QA `-prefixed records and remove them afterwards.
- Custom HMAC session cookie (`sp_session`), verified in `middleware.ts`; customer portal uses a separate cookie (`sp_customer`). Prisma client is created in `lib/prisma.ts`.
- Vercel serverless, Next 14 App Router; hook transactions already run under tight time limits (accounting hooks: 5 s) — audit writes must not push existing transactions over those limits.
- Secrets never logged: at minimum `Employee.passwordHash`, `Retailer.portalPasswordHash`; builder to scan the schema for any others.

## Proposed approach (assistant's call — the builder may refine)

- A Prisma client extension on all model operations (`create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`) in `lib/prisma.ts`. For update/delete it reads the row first to capture old values. The audit insert runs in the same transaction as the business write so both commit or both roll back.
- **Actor propagation:** `middleware.ts` already verifies the cookie; it forwards the verified identity in an internal request header (any client-supplied copy of that header must be stripped/overwritten), and the extension reads it from the request context. Portal requests identify as the customer. No request context ⇒ actor "script".
- Exclusions: the `AuditLog` table itself; auto-posted `JournalEntry`/`JournalLine`; `Notification` (derived noise, builder's call to confirm); updates that only touch portal login counters (`portalFailedAttempts`, `portalLockedUntil`, `portalLastLoginAt`) because logins are logged separately.
- `AuditLog` columns (builder to finalise): id, createdAt, actorType (EMPLOYEE | CUSTOMER | SYSTEM), actorId, actorName, actorRole, model, recordId, action (CREATE | UPDATE | DELETE | BULK_CREATE | BULK_UPDATE | BULK_DELETE | LOGIN | LOGIN_FAILED), changes (JSON: `{field: {from, to}}`), reason, ip (optional), indexes on (model, recordId), createdAt, actorId.
- Order History panel resolves related records (invoice, delivery, payments, returns, challan) via the order's ids.

## Calls made after the builder review (assistant's calls, not client decisions)

1. **Derived rows are logged.** Only auto-posted `JournalEntry`/`JournalLine` and `Notification` are excluded. Stock quantity changes (`MedicineBatch.currentQty`), `OrderItem.unitCost`/`deductedQty`, auto-created `Invoice`/`Delivery`/`DeliveryChallan` and offer-list refresh rows are real changes and stay in the log and in the order History panel. The Audit Log page offers a table filter so staff can narrow it; nothing is hidden by default.
2. **No exceptions to "fails together".** The audit insert goes in the same transaction as the business write. Accounting hook syncs run after the business transaction and mostly write skipped tables, so they add little. If a specific path times out in testing, the builder raises that path's transaction limits or batches its audit inserts rather than logging after commit.
3. **Nested writes and cascades.** A nested create (e.g. order with its items) is logged as one entry on the parent with the nested data in `changes`. A delete that cascades (Order → OrderItem, Retailer → DrugLicense) stores a snapshot of the cascaded children in the parent's entry. Edits to individual existing rows (e.g. an admin editing order lines) are logged per row.
4. **Actors in odd cases.** Env-admin login (`AUTH_USERNAME`) is recorded as actorType EMPLOYEE, actorId null, name "admin (env)". A delete executed after Manager request is attributed to the approving Admin; the Manager appears through the `DeleteApproval` row (itself logged). Failed login with an unknown username: recordId null, attempted username stored in `changes`. Portal customer logins and failures are logged with actorType CUSTOMER (or the attempted username when unknown).
5. **Reason** is an optional column. No new reason prompts are added to existing screens in this project; the later projects (on hold, returned, etc.) will supply reasons.
6. **No backfill.** History starts when the audit log goes live; existing orders show an empty History panel until they change.

## Left to the builder

Exact table/column names and indexes; the redaction list beyond the two known hashes; the extension mechanics (including interactive-transaction and raw-SQL gaps); pagination and filter UI; how long values (e.g. large JSON) are truncated; whether an `ip` column is worth it.

## Success

An Admin can open any order and see its full change history, open the Audit Log page and answer "who changed this and when", and no existing page or workflow is noticeably slower or behaves differently for other roles.
