/** Only a DRAFT order can have its lines replaced through the draft route. */
export function isDraftEditable(status: string): boolean {
  return status === 'DRAFT'
}

/** Whether an order of this status counts as a sale in counts/totals/reports. */
export function countsAsSale(status: string): boolean {
  return status !== 'DRAFT' && status !== 'CANCELLED'
}
