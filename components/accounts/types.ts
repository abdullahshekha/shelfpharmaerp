export interface Account {
  id: string
  code: string
  name: string
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'
  subType: string | null
  systemKey: string | null
  isSystem: boolean
  isActive: boolean
  parentId: string | null
  balance?: number
}

export const ACCOUNT_TYPES: Account['type'][] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']

export const TYPE_LABELS: Record<Account['type'], string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
}

export interface AccountingSettings {
  id: string
  goLiveDate: string | null
  lockedThrough: string | null
  defaultBankAccountId: string | null
}

export const SOURCE_LABELS: Record<string, string> = {
  INVOICE: 'Sales invoice',
  DELIVERY_COGS: 'Delivery (COGS)',
  PAYMENT: 'Customer payment',
  SALES_RETURN: 'Sales return',
  PURCHASE_INVOICE: 'Purchase invoice',
  SUPPLIER_PAYMENT: 'Supplier payment',
  SUPPLIER_RETURN: 'Supplier return',
}

/** Page for the source record, only where its id is directly the page id. */
export function sourceHref(sourceType: string | null, sourceId: string | null): string | null {
  if (!sourceType || !sourceId) return null
  switch (sourceType) {
    case 'INVOICE': return `/invoices/${sourceId}`
    case 'DELIVERY_COGS': return `/orders/${sourceId}`
    case 'PURCHASE_INVOICE': return `/purchase-invoices/${sourceId}`
    default: return null
  }
}

/** YYYY-MM-DD calendar day in Asia/Karachi (the API stores Karachi-midnight dates, i.e. 19:00 UTC the previous day). */
export function karachiDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
}
export const todayKarachi = () => karachiDay(new Date())
export const toDateInput = (iso: string | null | undefined) => (iso ? karachiDay(iso) : '')
