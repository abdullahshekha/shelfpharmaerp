/**
 * Parent model -> children removed by `onDelete: Cascade` (child model + its FK field to the parent).
 * Mirrors prisma/schema.prisma; tests/audit/cascade.test.ts fails if the two drift apart.
 */
export const CASCADE_CHILDREN: Record<string, { model: string; fk: string }[]> = {
  SupplierReturn: [{ model: 'SupplierReturnItem', fk: 'supplierReturnId' }],
  PurchaseInvoice: [{ model: 'PurchaseInvoiceItem', fk: 'purchaseInvoiceId' }],
  Retailer: [{ model: 'DrugLicense', fk: 'retailerId' }],
  Order: [{ model: 'OrderItem', fk: 'orderId' }],
  OfferList: [
    { model: 'OfferListItem', fk: 'offerListId' },
    { model: 'OfferListAssignment', fk: 'offerListId' },
    { model: 'OfferListCustomer', fk: 'offerListId' },
  ],
  OfferListCustomer: [{ model: 'OfferListCustomerItem', fk: 'offerListCustomerId' }],
  SalesReturn: [{ model: 'SalesReturnItem', fk: 'salesReturnId' }],
  JournalEntry: [{ model: 'JournalLine', fk: 'entryId' }],
  PayrollRun: [{ model: 'PayrollLine', fk: 'runId' }],
}

/** Rows kept per child model in a cascade snapshot; the rest is counted, not stored. */
export const CASCADE_SNAPSHOT_CAP = 500
