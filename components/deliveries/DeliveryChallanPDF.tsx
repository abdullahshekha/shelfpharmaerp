import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, padding: 32, paddingBottom: 60, color: '#1e293b' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: '#2563eb' },
  company: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#1e3a8a' },
  sub: { fontSize: 8, color: '#64748b', marginTop: 2 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#2563eb', textAlign: 'right' },
  meta: { fontSize: 8.5, color: '#475569', textAlign: 'right', marginTop: 2 },

  infoRow: { flexDirection: 'row', marginBottom: 12 },
  infoBox: { flex: 1, borderWidth: 0.75, borderColor: '#cbd5e1', padding: 8 },
  infoLabel: { fontSize: 7, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 },
  infoMain: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  infoSub: { fontSize: 8, color: '#475569', marginTop: 1.5 },

  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#0f172a', paddingVertical: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#cbd5e1', paddingVertical: 4 },
  colNo: { width: '6%', color: '#94a3b8' },
  colItem: { width: '52%' },
  colPack: { width: '16%' },
  colQty: { width: '13%', textAlign: 'right' },
  colBonus: { width: '13%', textAlign: 'right' },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#475569', textTransform: 'uppercase' },
  itemName: { fontFamily: 'Helvetica-Bold' },
  itemSub: { fontSize: 7, color: '#64748b', marginTop: 1 },

  totals: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, gap: 16 },
  totalText: { fontSize: 9, fontFamily: 'Helvetica-Bold' },

  sigRow: { flexDirection: 'row', gap: 24, marginTop: 36 },
  sigBox: { flex: 1 },
  sigLine: { borderTopWidth: 0.75, borderTopColor: '#0f172a', paddingTop: 3, fontSize: 8, color: '#475569' },
  note: { marginTop: 14, fontSize: 7.5, color: '#64748b' },

  footer: { position: 'absolute', bottom: 20, left: 32, right: 32, borderTopWidth: 0.5, borderTopColor: '#cbd5e1', paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: '#94a3b8' },
})

export interface ChallanData {
  challanNumber: string
  challanDate: string
  orderNumber: string
  invoiceNumber: string | null
  scheduledDate: string | null
  driverName: string | null
  customer: { name: string; phone: string | null; address: string | null; area: string | null }
  items: { id: string; name: string; manufacturer: string | null; packSize: string | null; quantity: number; bonusQty: number }[]
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })

// One page-flow per challan (long item lists wrap onto further pages automatically). No prices by design.
export function DeliveryChallanPDF({ challans }: { challans: ChallanData[] }) {
  return (
    <Document title="Delivery Challan" author="Shelf Pharma">
      {challans.map(c => {
        const totalQty = c.items.reduce((sum, i) => sum + i.quantity, 0)
        const totalBonus = c.items.reduce((sum, i) => sum + i.bonusQty, 0)
        return (
          <Page key={c.challanNumber} size="A4" style={s.page}>
            <View style={s.header}>
              <View>
                <Text style={s.company}>Shelf Pharma</Text>
                <Text style={s.sub}>PECHS Ext. Block 6, Karachi · 0330-7774353</Text>
              </View>
              <View>
                <Text style={s.title}>DELIVERY CHALLAN</Text>
                <Text style={s.meta}>{c.challanNumber}</Text>
                <Text style={s.meta}>Date: {fmtDate(c.challanDate)}</Text>
              </View>
            </View>

            <View style={s.infoRow}>
              <View style={s.infoBox}>
                <Text style={s.infoLabel}>Deliver to</Text>
                <Text style={s.infoMain}>{c.customer.name}</Text>
                {c.customer.address && <Text style={s.infoSub}>{c.customer.address}</Text>}
                {c.customer.area && <Text style={s.infoSub}>Area: {c.customer.area}</Text>}
                {c.customer.phone && <Text style={s.infoSub}>Phone: {c.customer.phone}</Text>}
              </View>
              <View style={[s.infoBox, { marginLeft: 10 }]}>
                <Text style={s.infoLabel}>Reference</Text>
                <Text style={s.infoSub}>Order: {c.orderNumber}</Text>
                {c.invoiceNumber && <Text style={s.infoSub}>Invoice: {c.invoiceNumber}</Text>}
                {c.scheduledDate && <Text style={s.infoSub}>Delivery date: {fmtDate(c.scheduledDate)}</Text>}
                <Text style={s.infoSub}>Driver: {c.driverName ?? '____________________'}</Text>
              </View>
            </View>

            <View style={s.tableHeader} fixed>
              <Text style={[s.th, s.colNo]}>#</Text>
              <Text style={[s.th, s.colItem]}>Item</Text>
              <Text style={[s.th, s.colPack]}>Pack</Text>
              <Text style={[s.th, s.colQty]}>Qty</Text>
              <Text style={[s.th, s.colBonus]}>Bonus</Text>
            </View>
            {c.items.map((i, idx) => (
              <View key={i.id} style={s.row} wrap={false}>
                <Text style={s.colNo}>{idx + 1}</Text>
                <View style={s.colItem}>
                  <Text style={s.itemName}>{i.name}</Text>
                  {i.manufacturer && <Text style={s.itemSub}>{i.manufacturer}</Text>}
                </View>
                <Text style={s.colPack}>{i.packSize ?? '—'}</Text>
                <Text style={s.colQty}>{i.quantity}</Text>
                <Text style={s.colBonus}>{i.bonusQty > 0 ? i.bonusQty : '—'}</Text>
              </View>
            ))}

            <View style={s.totals} wrap={false}>
              <Text style={s.totalText}>Items: {c.items.length}</Text>
              <Text style={s.totalText}>Total Qty: {totalQty}</Text>
              {totalBonus > 0 && <Text style={s.totalText}>Total Bonus: {totalBonus}</Text>}
            </View>

            <View style={s.sigRow} wrap={false}>
              <View style={s.sigBox}><Text style={s.sigLine}>Receiver name</Text></View>
              <View style={s.sigBox}><Text style={s.sigLine}>Receiver signature &amp; stamp</Text></View>
              <View style={s.sigBox}><Text style={s.sigLine}>Date / time received</Text></View>
            </View>
            <Text style={s.note}>Goods received in good condition. Please check quantities at the time of delivery.</Text>

            <View style={s.footer} fixed>
              <Text style={s.footerText}>Shelf Pharma · {c.challanNumber}</Text>
              <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
            </View>
          </Page>
        )
      })}
    </Document>
  )
}
