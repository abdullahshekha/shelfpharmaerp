export function formatPKR(amount: number | { toString(): string } | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : parseFloat(amount.toString())
  return `Rs. ${num.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-PK', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function generateOrderNumber(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')
  return `SP-${date}-${seq}`
}

export function generateInvoiceNumber(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')
  return `SP-INV-${date}-${seq}`
}

export function getNextDeliveryDate(): Date {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
  const cutoff = new Date(now)
  cutoff.setHours(18, 0, 0, 0)

  const delivery = new Date(now)
  delivery.setHours(9, 0, 0, 0)

  if (now < cutoff) {
    delivery.setDate(delivery.getDate() + 1)
  } else {
    delivery.setDate(delivery.getDate() + 2)
  }

  return delivery
}
