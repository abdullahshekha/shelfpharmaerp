import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const COLUMNS = 2
const ROWS_PER_COLUMN = 62 // tuned for A4 portrait at this font size to keep the list to as few pages as possible
const ROWS_PER_PAGE = COLUMNS * ROWS_PER_COLUMN

// Ink-saving: no filled backgrounds anywhere, only text and hairline rules.
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 7.5,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 24,
    color: '#1e293b',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: '#0f172a',
  },
  companyName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
  companyMeta: { fontSize: 6.5, color: '#64748b', marginTop: 1 },
  listMeta: { fontSize: 7, color: '#334155', textAlign: 'right' },
  columns: { flexDirection: 'row', flex: 1 },
  column: { flex: 1, marginHorizontal: 5 },
  mfgRow: {
    color: '#0f172a',
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
    paddingTop: 3,
    paddingBottom: 1,
    paddingHorizontal: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: '#0f172a',
  },
  itemRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.25,
    borderBottomColor: '#cbd5e1',
    paddingVertical: 1.5,
    paddingHorizontal: 3,
  },
  itemName: { flex: 3.2 },
  itemOffer: { flex: 0.9, textAlign: 'right' },
  itemComments: { flex: 1.3, textAlign: 'right', color: '#475569' },
  footer: {
    position: 'absolute',
    bottom: 10,
    left: 24,
    right: 24,
    fontSize: 6,
    color: '#94a3b8',
    textAlign: 'center',
  },
})

interface PDFItem {
  medicine: { name: string; manufacturer: { name: string } }
  offerPercent: number
  comments: string
}

interface OfferListPDFProps {
  listNumber: string
  listDate: string
  items: PDFItem[]
}

type Row = { type: 'header'; text: string } | { type: 'item'; item: PDFItem }

function buildRows(items: PDFItem[]): Row[] {
  const byMfg = new Map<string, PDFItem[]>()
  for (const item of items) {
    const mfg = item.medicine.manufacturer.name
    if (!byMfg.has(mfg)) byMfg.set(mfg, [])
    byMfg.get(mfg)!.push(item)
  }
  const rows: Row[] = []
  for (const mfg of Array.from(byMfg.keys()).sort()) {
    rows.push({ type: 'header', text: mfg })
    for (const item of byMfg.get(mfg)!) rows.push({ type: 'item', item })
  }
  return rows
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function RowBlock({ row }: { row: Row }) {
  if (row.type === 'header') {
    return (
      <View style={styles.mfgRow}>
        <Text>{row.text}</Text>
      </View>
    )
  }
  const { item } = row
  return (
    <View style={styles.itemRow}>
      <Text style={styles.itemName}>{item.medicine.name}</Text>
      <Text style={styles.itemOffer}>{Number(item.offerPercent) > 0 ? `${Number(item.offerPercent).toFixed(2)}%` : '—'}</Text>
      <Text style={styles.itemComments}>{item.comments}</Text>
    </View>
  )
}

export function OfferListPDF({ listNumber, listDate, items }: OfferListPDFProps) {
  const rows = buildRows(items)
  const pages = chunk(rows, ROWS_PER_PAGE)

  return (
    <Document>
      {pages.map((pageRows, pageIndex) => {
        const columnChunks = chunk(pageRows, ROWS_PER_COLUMN)
        return (
          <Page key={pageIndex} size="A4" style={styles.page}>
            <View style={styles.header}>
              <View>
                <Text style={styles.companyName}>ShelfPharma</Text>
                <Text style={styles.companyMeta}>PECHS Ext. Block 6, Karachi · WhatsApp 0330-7774353</Text>
              </View>
              <View>
                <Text style={styles.listMeta}>Offer List #{listNumber}</Text>
                <Text style={styles.listMeta}>{listDate}</Text>
              </View>
            </View>

            <View style={styles.columns}>
              {columnChunks.map((col, colIndex) => (
                <View key={colIndex} style={styles.column}>
                  {col.map((row, rowIndex) => (
                    <RowBlock key={rowIndex} row={row} />
                  ))}
                </View>
              ))}
            </View>

            <Text
              style={styles.footer}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
              fixed
            />
          </Page>
        )
      })}
    </Document>
  )
}
