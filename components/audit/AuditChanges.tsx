'use client'

export type AuditRow = {
  id: string
  createdAt: string
  actorType: string
  actorId: string | null
  actorName: string | null
  actorRole: string | null
  model: string
  recordId: string
  action: string
  changes: unknown
  reason: string | null
}

const MAX = 120

export function fmtValue(v: unknown): { text: string; full: string } {
  let full: string
  if (v === null || v === undefined) full = '—'
  else if (typeof v === 'string') full = v
  else {
    try { full = JSON.stringify(v) ?? String(v) } catch { full = String(v) }
  }
  return { text: full.length > MAX ? full.slice(0, MAX) + '…' : full, full }
}

function Val({ v }: { v: unknown }) {
  const { text, full } = fmtValue(v)
  return <span title={full} className="font-mono break-all">{text}</span>
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export default function AuditChanges({ action, changes, reason }: { action: string; changes: unknown; reason?: string | null }) {
  const rows: React.ReactNode[] = []
  const c = isObj(changes) ? changes : null
  const isLogin = action === 'LOGIN' || action === 'LOGIN_FAILED'

  if (isLogin) {
    if (c?.username !== undefined) rows.push(<div key="u">username: <Val v={c.username} /></div>)
    const r = c?.reason ?? reason
    if (r) rows.push(<div key="r">reason: <Val v={r} /></div>)
  } else if (action.startsWith('BULK_')) {
    const ids = Array.isArray(c?.ids) ? (c!.ids as unknown[]) : []
    rows.push(<div key="n">{String(c?.count ?? ids.length)} record(s) affected</div>)
    if (c?.truncated) rows.push(<div key="t" className="text-amber-700">Id list truncated; not every affected record is listed.</div>)
    if (ids.length) rows.push(<div key="i" className="text-slate-500">ids: <Val v={ids.join(', ')} /></div>)
  } else if (c) {
    for (const [field, val] of Object.entries(c)) {
      if (field === '_cascaded') {
        if (isObj(val)) {
          for (const [m, list] of Object.entries(val)) {
            rows.push(<div key={'c' + m} className="text-slate-600">also deleted: {Array.isArray(list) ? list.length : '?'} {m} row(s)</div>)
          }
        }
        continue
      }
      if (isObj(val) && ('from' in val || 'to' in val)) {
        if (action === 'CREATE') rows.push(<div key={field}><b>{field}</b>: <Val v={val.to} /></div>)
        else if (action === 'DELETE') rows.push(<div key={field}><b>{field}</b>: <Val v={val.from} /></div>)
        else rows.push(<div key={field}><b>{field}</b>: <Val v={val.from} /> <span className="text-slate-400">→</span> <Val v={val.to} /></div>)
      } else {
        rows.push(<div key={field}><b>{field}</b>: <Val v={val} /></div>)
      }
    }
  }
  if (reason && !isLogin) rows.push(<div key="reason">reason: <Val v={reason} /></div>)
  if (rows.length === 0) return <span className="text-slate-400">No details</span>
  return <div className="space-y-0.5 text-xs">{rows}</div>
}

/** One-line summary for the collapsed table cell. */
export function summarize(action: string, changes: unknown): string {
  const c = isObj(changes) ? changes : null
  if (action === 'LOGIN' || action === 'LOGIN_FAILED') return c?.username ? `user ${String(c.username)}` : action
  if (action.startsWith('BULK_')) return `${String(c?.count ?? '?')} records`
  if (!c) return 'No details'
  const fields = Object.keys(c).filter((k) => k !== '_cascaded')
  const casc = isObj(c._cascaded) ? `${Object.keys(c._cascaded).length} related model(s)` : ''
  if (fields.length === 0) return casc || 'No details'
  const shown = fields.slice(0, 3).join(', ')
  return `${shown}${fields.length > 3 ? ` +${fields.length - 3} more` : ''}${casc ? ' + ' + casc : ''}`
}
