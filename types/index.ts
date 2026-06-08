export type UserRole = 'ADMIN' | 'STAFF' | 'SALES_REP' | 'DRIVER' | 'WAREHOUSE'

export type OrderStatusType = 'PENDING' | 'CONFIRMED' | 'PICKING' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED'
export type OrderSourceType = 'MANUAL' | 'OFFER_LIST' | 'WHATSAPP'
export type InvoiceStatusType = 'DRAFT' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE'
export type DeliveryStatusType = 'SCHEDULED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RESCHEDULED'
export type WhatsappOrderStatusType = 'PENDING_REVIEW' | 'AI_PROCESSED' | 'AUTO_REPLY_SENT' | 'CONFIRMED' | 'REJECTED'
export type PaymentMethodType = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE'
export type AttendanceStatusType = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE'

export interface ExtractedOrderItem {
  rawName: string
  cleanedName: string
  quantity: number
  unit: 'strip' | 'bottle' | 'tube' | 'sachet' | 'unknown'
  dosage: string | null
  form: 'tablet' | 'syrup' | 'capsule' | 'cream' | 'drops' | 'sachet' | 'unknown'
  matchedMedicineId?: string
  confidence?: number
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ApiResponse<T> {
  data: T
  meta?: PaginationMeta
  error?: string
}
