# Post Dated Cheque (PDC) Management — Design

Date: 2026-11-09. Part 2 of 3 (1: audit log, shipped; 3: Orders/Deliveries rework, next).

## Intent and why

Customers pay by cheque dated in the future; ShelfPharma also pays suppliers by cheque. Today choosing "Cheque" when recording a payment posts the money immediately, as if it had arrived. The client wants cheques tracked as promises until they actually clear, so balances, invoice status and the bank ledger only change when real money moves. Project 3 (deliveries) will have salesmen collect cheques at delivery and depends on this module.

## Goals

- A **PDC Management** page listing every cheque, with a Receivables / Payables filter (receivables come from Sales, payables from Purchase) plus filters for status, bank, date range, party, and search by cheque number.
- Four statuses: **Pending, Stopped, Returned, Cleared**.
- While Pending (or Stopped/Returned) a cheque changes **nothing** in the customer/supplier balance, invoice status or ledger. It shows only in PDC Management.
- Marking a cheque **Cleared** records the payment(s) and posts the money to the cheque's own bank account (from the Chart of Accounts) in one atomic step.
- Choosing **Cheque** on the existing "record payment" screens for customer invoices and supplier invoices creates a Pending cheque instead of posting a payment.
- Every status change and every edit is audit-logged (project 1 already does this for every write).

## Non-goals

- No automatic bank reconciliation or bank-statement import.
- No cheque printing.
- No reminders/alerts for upcoming cheque dates (a "due soon" filter is enough).
- Delivery-time capture UI (picture, salesman flow) belongs to project 3; this project provides the data and API it will use.

## Anti-goals

- A cheque that is not Cleared must never reduce a balance or mark an invoice paid.
- Clearing the same cheque twice must never double-post money.
- Customer and supplier cheques must never be mixed up in one list total.

## Decisions made with the client

- **Cleared is final.** A manager marks a cheque Cleared by hand once the money is in the bank; after that it cannot become Stopped or Returned and nothing about it (except notes) can change. No reversal path is built.
- **No credit or prepayment ever exists.** A cheque is never worth more than what the party owes. Clearing is refused when the cheque amount is more than the party's total unpaid invoices at that moment (the user fixes the amount first). No customer-credit or supplier-prepayment concept is added.

- **While pending:** shows as uncleared/pending, only inside PDC Management; balances/ledger untouched.
- **Entry points:** the salesman records it at delivery, a manager records it afterwards (e.g. dropped at the office, or issued to a supplier). Existing Cheque option on payment screens creates a Pending cheque.
- **Returned/Stopped are not final.** Afterwards the customer may pay in cash, give a new cheque, or the same cheque may be presented again. So a Returned or Stopped cheque can go back to Pending and then Cleared.
- **Many-to-many with invoices:** one cheque may pay several invoices; several cheques may pay one invoice.
- **Allocation is automatic, oldest invoice first**, never chosen by hand: a cleared cheque pays the party's oldest unpaid invoice, then the next oldest, and so on. Same rule for supplier cheques against purchase invoices.
- **Allocation happens at clearing, not at recording.** Nothing is reserved while Pending; each cheque, when it clears, pays whatever is oldest and open at that moment.
- **Who changes status:** accountant, manager or admin may mark Pending / Stopped / Returned / Cleared.
- **Bank link:** each cheque is linked to a bank account from the Chart of Accounts; clearing posts to that account.

## Constraints

- Production database, no staging: schema changes purely additive; QA with `QA `-prefixed records removed afterwards (see CLAUDE.md).
- Accounting is a double-entry ledger kept in sync by `lib/accounting/sync.ts` from source records (`Payment`, `SupplierPayment`). Today a payment posts to `AccountingSettings.defaultBankAccountId`; this project must let a payment post to the bank named on its cheque. The ledger posting must keep working through the existing sync/rebuild (a Rebuild must reproduce the same entries).
- Accounting lock/go-live rules apply: a cheque cannot be cleared with a clearing date in a locked period.
- Audit log: writes must use the audited Prisma client; array-form `$transaction` is not allowed for audited writes.
- Money is `Decimal`, PKR, Karachi time.
- Existing nav (`lib/nav.ts`): PDC page lives under Accounts (ADMIN + ACCOUNTANT) and must also be reachable by MANAGER (and the salesman API path for project 3).

## Calls made by the assistant (not client decisions — please check)

1. **Acknowledgment:** a cheque recorded by a salesman carries a separate "acknowledged by manager/admin" flag (who, when). It is not a fifth status. Unacknowledged cheques are visibly marked and can be filtered. A cheque can be cleared only after acknowledgment.
2. **Replacement link:** a Returned/Stopped cheque can optionally be linked to the cheque or payment that replaced it; purely informational.
3. **Cheque fields:** number, amount, cheque date (post-dated), received/issued date, bank (Chart of Accounts account), drawer bank name (free text, receivables), party, optional picture URL (Supabase Storage), notes, status history via audit log.
4. **Clearing date:** the accountant enters the clearing date (default today); payments are dated that day; it cannot be in the future.
5. **Cheque date in the future:** allowed to be cleared early only by ADMIN/MANAGER/ACCOUNTANT with the clearing date not in the future; no hard block on clearing before the cheque date.
6. **Existing data:** there are no real cheque payments in production yet (checked before the build; recheck).

## Further calls made after the builder check (assistant's calls)

7. **Allocations are frozen at clearing.** Clearing creates real payment rows (one per invoice share) stored with the cheque; a Rebuild just re-syncs those rows and never re-runs the oldest-first logic.
8. **The invoice on the existing payment screen is only the party selector.** Choosing Cheque there creates a Pending cheque for that customer/supplier; the invoice picked is not honoured (oldest-first applies at clearing). Payments created by clearing use method CHEQUE with the cheque number as reference.
9. **Roles:** a salesman can create cheques only for their own deliveries and edit them only until acknowledged. Cheques recorded by a manager/admin/accountant are acknowledged automatically. Accountant/manager/admin may edit amount, date, bank, party until Cleared; after Cleared nothing but notes is editable.
10. **Bank account** is optional while a cheque is unacknowledged (a salesman may not know the deposit bank) and required before it can be cleared.
11. **Dates:** clearing date must be on or after the received date, not in the future, and not before go-live or in a locked period.
12. **Pending cheques do not appear** on the customer page, credit warning or invoice status; they live only in PDC Management.

## Left to the builder

Table and column names; how allocations of a cleared cheque are stored; how "oldest unpaid" is computed (reuse the existing outstanding logic in `lib/utils/outstanding.ts`); UI layout of the list and detail; how the Cheque option on the existing payment screens is wired; how the bank account is carried onto the payment so the sync posts to it.

## Success

A manager can record a cheque, see it Pending without any balance change, mark it Cleared, and see the oldest invoices paid and the correct bank account increased; a bounced cheque can be marked Returned, later re-presented and cleared, and a Cleared cheque can no longer be changed; the audit log shows each step; the Trial Balance stays balanced after a Rebuild.
