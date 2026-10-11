const csvCell = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** Client-side CSV download. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const text = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n')
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
