export type DeliveryColumn = 'TO_DISPATCH' | 'OUT' | 'DELIVERED'

/** Which board column a delivery sits in. */
export function nextDeliveryColumn(status: string): DeliveryColumn {
  if (status === 'OUT_FOR_DELIVERY') return 'OUT'
  if (status === 'DELIVERED') return 'DELIVERED'
  return 'TO_DISPATCH' // SCHEDULED | RESCHEDULED | FAILED
}

/** The delivery says done but the order was never marked delivered (stock not deducted). */
export function deliveryMismatch(deliveryStatus: string, orderStatus: string): boolean {
  return deliveryStatus === 'DELIVERED' && orderStatus !== 'DELIVERED'
}
