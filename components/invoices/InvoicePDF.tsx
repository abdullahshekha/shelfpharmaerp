import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
    color: '#1e293b',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
  },
  companyName: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#1e3a8a',
    marginBottom: 3,
  },
  companyMeta: {
    fontSize: 8,
    color: '#64748b',
    marginBottom: 1,
  },
  invoiceLabel: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#2563eb',
    textAlign: 'right',
  },
  invoiceNumber: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    marginTop: 2,
    color: '#1e293b',
  },
  invoiceMeta: {
    fontSize: 8,
    textAlign: 'right',
    color: '#64748b',
    marginTop: 2,
  },

  // Bill To / Order Info row
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  infoBox: {
    width: '48%',
  },
  infoLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoName: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 2,
  },
  infoText: {
    fontSize: 8,
    color: '#475569',
    marginBottom: 1,
  },

  // Table
  table: {
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e3a8a',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tableRowAlt: {
    backgroundColor: '#f8fafc',
  },
  tableCell: {
    fontSize: 8,
    color: '#334155',
  },
  tableCellBold: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  medicineCode: {
    fontSize: 7,
    color: '#94a3b8',
    marginTop: 1,
  },

  // Column widths
  colName: { width: '40%' },
  colQty: { width: '8%', textAlign: 'center' },
  colPrice: { width: '18%', textAlign: 'right' },
  colOffer: { width: '10%', textAlign: 'center' },
  colAmount: { width: '24%', textAlign: 'right' },

  // Totals
  totalsSection: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 20,
  },
  totalsBox: {
    width: '40%',
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  totalsLabel: {
    fontSize: 8,
    color: '#64748b',
  },
  totalsValue: {
    fontSize: 8,
    color: '#1e293b',
  },
  totalsFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    backgroundColor: '#1e3a8a',
    paddingHorizontal: 6,
    marginTop: 2,
  },
  totalsFinalLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
  },
  totalsFinalValue: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
  },

  // Payments
  paymentsSection: {
    marginBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#475569',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  paymentText: {
    fontSize: 8,
    color: '#475569',
  },
  paymentAmount: {
    fontSize: 8,
    color: '#16a34a',
    fontFamily: 'Helvetica-Bold',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  balanceLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  balanceDue: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#dc2626',
  },
  balancePaid: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#16a34a',
  },

  // Status stamp
  stampContainer: {
    position: 'absolute',
    top: 160,
    right: 40,
  },
  stampPaid: {
    borderWidth: 3,
    borderColor: '#16a34a',
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    transform: 'rotate(-15deg)',
  },
  stampUnpaid: {
    borderWidth: 3,
    borderColor: '#dc2626',
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    transform: 'rotate(-15deg)',
  },
  stampTextPaid: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#16a34a',
    opacity: 0.35,
    letterSpacing: 2,
  },
  stampTextUnpaid: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#dc2626',
    opacity: 0.35,
    letterSpacing: 2,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7,
    color: '#94a3b8',
  },

  // Notes
  notesBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    padding: 8,
    marginBottom: 16,
  },
  notesText: {
    fontSize: 8,
    color: '#475569',
  },
})

export interface InvoicePDFProps {
  invoice: {
    invoiceNumber: string
    invoiceDate: string
    dueDate: string | null
    subtotal: number
    discountAmount: number
    taxAmount: number
    totalAmount: number
    status: string
    notes: string | null
    retailer: {
      name: string
      ownerName: string | null
      phone: string | null
      area: string | null
      address: string | null
      drugLicenseNumber: string | null
    }
    order: {
      orderNumber: string
      items: {
        id: string
        quantity: number
        unitPrice: number
        offerPercent: number
        lineTotal: number
        medicine: { name: string; code: string }
      }[]
    }
    payments: {
      id: string
      amount: number
      paymentDate: string
      method: string
      reference?: string | null
    }[]
  }
}

function fmtPKR(v: number | string) {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return `Rs. ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string | null | undefined) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-PK', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function InvoicePDF({ invoice }: InvoicePDFProps) {
  const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0)
  const balance = Number(invoice.totalAmount) - totalPaid
  const isPaid = invoice.status === 'PAID' || balance <= 0

  return (
    <Document
      title={invoice.invoiceNumber}
      author="Shelf Pharma"
      subject="Invoice"
    >
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>Shelf Pharma</Text>
            <Text style={styles.companyMeta}>PECHS Ext. Block 6, Karachi, Pakistan</Text>
            <Text style={styles.companyMeta}>WhatsApp: 0330-7774353</Text>
          </View>
          <View>
            <Text style={styles.invoiceLabel}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
            <Text style={styles.invoiceMeta}>Date: {fmtDate(invoice.invoiceDate)}</Text>
            {invoice.dueDate && (
              <Text style={styles.invoiceMeta}>Due: {fmtDate(invoice.dueDate)}</Text>
            )}
            <Text style={styles.invoiceMeta}>Order: {invoice.order.orderNumber}</Text>
          </View>
        </View>

        {/* Bill To */}
        <View style={styles.infoRow}>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Bill To</Text>
            <Text style={styles.infoName}>{invoice.retailer.name}</Text>
            {invoice.retailer.ownerName && (
              <Text style={styles.infoText}>{invoice.retailer.ownerName}</Text>
            )}
            {invoice.retailer.area && (
              <Text style={styles.infoText}>{invoice.retailer.area}</Text>
            )}
            {invoice.retailer.address && (
              <Text style={styles.infoText}>{invoice.retailer.address}</Text>
            )}
            {invoice.retailer.phone && (
              <Text style={styles.infoText}>Tel: {invoice.retailer.phone}</Text>
            )}
            {invoice.retailer.drugLicenseNumber && (
              <Text style={styles.infoText}>Drug License: {invoice.retailer.drugLicenseNumber}</Text>
            )}
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Payment Status</Text>
            <Text style={{ ...styles.infoName, color: isPaid ? '#16a34a' : '#dc2626' }}>
              {invoice.status}
            </Text>
            {totalPaid > 0 && !isPaid && (
              <Text style={styles.infoText}>Paid: {fmtPKR(totalPaid)}</Text>
            )}
            {!isPaid && (
              <Text style={{ ...styles.infoText, color: '#dc2626', fontFamily: 'Helvetica-Bold' }}>
                Balance: {fmtPKR(balance)}
              </Text>
            )}
          </View>
        </View>

        {/* Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={{ ...styles.tableHeaderCell, ...styles.colName }}>Medicine</Text>
            <Text style={{ ...styles.tableHeaderCell, ...styles.colQty }}>Qty</Text>
            <Text style={{ ...styles.tableHeaderCell, ...styles.colPrice }}>Unit Price</Text>
            <Text style={{ ...styles.tableHeaderCell, ...styles.colOffer }}>Offer</Text>
            <Text style={{ ...styles.tableHeaderCell, ...styles.colAmount }}>Amount</Text>
          </View>
          {invoice.order.items.map((item, i) => (
            <View key={item.id} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <View style={styles.colName}>
                <Text style={styles.tableCellBold}>{item.medicine.name}</Text>
                <Text style={styles.medicineCode}>{item.medicine.code}</Text>
              </View>
              <Text style={{ ...styles.tableCell, ...styles.colQty }}>{item.quantity}</Text>
              <Text style={{ ...styles.tableCell, ...styles.colPrice }}>{fmtPKR(item.unitPrice)}</Text>
              <Text style={{ ...styles.tableCell, ...styles.colOffer }}>
                {Number(item.offerPercent) > 0 ? `${item.offerPercent}%` : '—'}
              </Text>
              <Text style={{ ...styles.tableCellBold, ...styles.colAmount }}>{fmtPKR(item.lineTotal)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{fmtPKR(invoice.subtotal)}</Text>
            </View>
            {Number(invoice.discountAmount) > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Discount</Text>
                <Text style={{ ...styles.totalsValue, color: '#dc2626' }}>
                  -{fmtPKR(invoice.discountAmount)}
                </Text>
              </View>
            )}
            {Number(invoice.taxAmount) > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Tax</Text>
                <Text style={styles.totalsValue}>{fmtPKR(invoice.taxAmount)}</Text>
              </View>
            )}
            <View style={styles.totalsFinalRow}>
              <Text style={styles.totalsFinalLabel}>TOTAL</Text>
              <Text style={styles.totalsFinalValue}>{fmtPKR(invoice.totalAmount)}</Text>
            </View>
          </View>
        </View>

        {/* Payments */}
        {invoice.payments.length > 0 && (
          <View style={styles.paymentsSection}>
            <Text style={styles.sectionTitle}>Payments Received</Text>
            {invoice.payments.map(p => (
              <View key={p.id} style={styles.paymentRow}>
                <Text style={styles.paymentText}>
                  {fmtDate(p.paymentDate)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}
                </Text>
                <Text style={styles.paymentAmount}>+{fmtPKR(p.amount)}</Text>
              </View>
            ))}
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Balance Due</Text>
              <Text style={balance <= 0 ? styles.balancePaid : styles.balanceDue}>
                {balance <= 0 ? 'PAID IN FULL' : fmtPKR(balance)}
              </Text>
            </View>
          </View>
        )}

        {/* Notes */}
        {invoice.notes && (
          <View style={styles.notesBox}>
            <Text style={{ ...styles.notesText, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        )}

        {/* PAID / UNPAID stamp */}
        <View style={styles.stampContainer}>
          <View style={isPaid ? styles.stampPaid : styles.stampUnpaid}>
            <Text style={isPaid ? styles.stampTextPaid : styles.stampTextUnpaid}>
              {isPaid ? 'PAID' : 'UNPAID'}
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Shelf Pharma · PECHS Ext. Block 6, Karachi · 0330-7774353</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          } />
        </View>

      </Page>
    </Document>
  )
}
