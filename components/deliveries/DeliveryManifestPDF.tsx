import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, padding: 32, color: '#1e293b' },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: '#2563eb' },
  company: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#1e3a8a' },
  sub: { fontSize: 8, color: '#64748b', marginTop: 2 },
  manifestTitle: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#2563eb', textAlign: 'right' },
  date: { fontSize: 9, color: '#475569', textAlign: 'right', marginTop: 3 },

  areaHeader: { backgroundColor: '#1e3a8a', padding: '6 10', marginBottom: 0 },
  areaName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  areaCount: { fontSize: 8, color: '#93c5fd', marginTop: 1 },

  tableHeader: { flexDirection: 'row', backgroundColor: '#e2e8f0', padding: '4 6' },
  tableRow: { flexDirection: 'row', padding: '5 6', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tableRowAlt: { backgroundColor: '#f8fafc' },

  col1: { width: '5%', fontSize: 8, color: '#94a3b8' },
  col2: { width: '28%' },
  col3: { width: '22%' },
  col4: { width: '25%' },
  col5: { width: '20%', textAlign: 'right' },

  colHeader: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#475569', textTransform: 'uppercase' },
  cellMain: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#1e293b' },
  cellSub: { fontSize: 7, color: '#64748b', marginTop: 1 },

  summary: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  summaryText: { fontSize: 8, color: '#475569' },

  footer: { position: 'absolute', bottom: 20, left: 32, right: 32, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: '#94a3b8' },
})

interface DeliveryItem {
  id: string
  status: string
  order: {
    orderNumber: string
    totalAmount: number
    retailer: {
      name: string
      phone: string | null
      address: string | null
      area: { name: string } | null
    }
  }
  driver: { name: string } | null
}

interface AreaGroup {
  areaName: string
  deliveries: DeliveryItem[]
}

export interface DeliveryManifestPDFProps {
  date: string
  areaGroups: AreaGroup[]
  totalDeliveries: number
}

function fmtPKR(v: number) {
  return `Rs. ${Number(v).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function DeliveryManifestPDF({ date, areaGroups, totalDeliveries }: DeliveryManifestPDFProps) {
  return (
    <Document title={`Delivery Manifest — ${date}`} author="Shelf Pharma">
      {areaGroups.map((group, gi) => (
        <Page key={gi} size="A4" style={s.page}>
          {/* Page header */}
          <View style={s.pageHeader}>
            <View>
              <Text style={s.company}>Shelf Pharma</Text>
              <Text style={s.sub}>PECHS Ext. Block 6, Karachi · 0330-7774353</Text>
            </View>
            <View>
              <Text style={s.manifestTitle}>DELIVERY MANIFEST</Text>
              <Text style={s.date}>{date}</Text>
              <Text style={s.date}>Page {gi + 1} of {areaGroups.length}</Text>
            </View>
          </View>

          {/* Area header */}
          <View style={s.areaHeader}>
            <Text style={s.areaName}>{group.areaName}</Text>
            <Text style={s.areaCount}>{group.deliveries.length} delivery / deliveries</Text>
          </View>

          {/* Table header */}
          <View style={s.tableHeader}>
            <Text style={[s.colHeader, s.col1]}>#</Text>
            <Text style={[s.colHeader, s.col2]}>Retailer</Text>
            <Text style={[s.colHeader, s.col3]}>Order #</Text>
            <Text style={[s.colHeader, s.col4]}>Address</Text>
            <Text style={[s.colHeader, s.col5]}>Amount</Text>
          </View>

          {group.deliveries.map((d, i) => (
            <View key={d.id} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
              <Text style={[{ fontSize: 8, color: '#94a3b8' }, s.col1]}>{i + 1}</Text>
              <View style={s.col2}>
                <Text style={s.cellMain}>{d.order.retailer.name}</Text>
                {d.order.retailer.phone && <Text style={s.cellSub}>{d.order.retailer.phone}</Text>}
              </View>
              <View style={s.col3}>
                <Text style={s.cellMain}>{d.order.orderNumber}</Text>
                <Text style={s.cellSub}>{d.status}</Text>
              </View>
              <View style={s.col4}>
                <Text style={s.cellSub}>{d.order.retailer.address ?? '—'}</Text>
              </View>
              <View style={s.col5}>
                <Text style={s.cellMain}>{fmtPKR(d.order.totalAmount)}</Text>
              </View>
            </View>
          ))}

          {/* Area summary */}
          <View style={s.summary}>
            <Text style={s.summaryText}>
              Area total: {group.deliveries.length} orders
            </Text>
            <Text style={{ ...s.summaryText, fontFamily: 'Helvetica-Bold' }}>
              {fmtPKR(group.deliveries.reduce((sum, d) => sum + Number(d.order.totalAmount), 0))}
            </Text>
          </View>

          {/* Driver signature line */}
          <View style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 8 }}>
            <Text style={{ fontSize: 8, color: '#64748b' }}>
              Driver: {group.deliveries[0]?.driver?.name ?? '___________________________'}
              {'          '}
              Signature: ___________________________
              {'          '}
              Date: _______________
            </Text>
          </View>

          <View style={s.footer} fixed>
            <Text style={s.footerText}>Shelf Pharma · Total deliveries this date: {totalDeliveries}</Text>
            <Text style={s.footerText}>Confidential — Internal Use Only</Text>
          </View>
        </Page>
      ))}
    </Document>
  )
}
