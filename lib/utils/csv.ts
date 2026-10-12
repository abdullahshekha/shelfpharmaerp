/**
 * Quotes one CSV cell. Strings starting with = + - @ tab or CR are prefixed with an apostrophe so spreadsheet
 * apps do not execute them as formulas (CSV injection). Real numbers (including negatives) are left untouched.
 */
export const csvCell = (v: string | number | null | undefined) => {
  let t = String(v ?? '')
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return `"${t.replace(/"/g, '""')}"`
}

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
