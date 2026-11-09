// Shape of a delivery as returned by GET /api/deliveries (Decimals arrive as strings/numbers: always Number() them).
export interface Assignee { id: string; name: string; role?: string }

export interface BoardDelivery {
  id: string
  scheduledDate: string
  status: string
  notes: string | null
  driverId: string | null
  driver: { name: string } | null
  outcome: string | null
  outcomeReason: string | null
  outcomeAt: string | null
  order: {
    id: string
    orderNumber: string
    status: string
    totalAmount: number | string
    discountAmount: number | string
    retailer: { name: string; area: { name: string } | null; address: string | null; phone: string | null }
    invoice: { id: string; invoiceNumber: string; totalAmount: number | string; status: string; payments: { amount: number | string }[] } | null
    items: {
      id: string
      quantity: number
      bonusQty: number | null
      lineTotal: number | string
      salesTaxAmount: number | string
      deductedQty: number | null
      medicine: { name: string }
    }[]
  }
}

export const OUTCOME_LABEL: Record<string, string> = {
  PAID_FULL: 'Paid in Full',
  PAID_WITH_RETURN: 'Paid with Return',
  RETURNED: 'Returned',
  ON_HOLD: 'On Hold',
  PAY_LATER: 'Delivered, Pay Later',
}
