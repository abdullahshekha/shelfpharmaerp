import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createHmac } from 'crypto'
import { NAV_HUBS, visibleTabs } from '@/lib/nav'

// Opens the first Settings tab the signed-in role may see (an ACCOUNTANT only has Chart of Accounts).
export default async function SettingsIndex() {
  const token = (await cookies()).get('sp_session')?.value
  let role = 'ADMIN'
  if (token) {
    try {
      const dot = token.lastIndexOf('.')
      const payload = token.slice(0, dot)
      const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret-2026'
      if (token.slice(dot + 1) === createHmac('sha256', secret).update(payload).digest('base64url')) {
        role = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')).role ?? 'ADMIN'
      }
    } catch {
      /* the ERP layout already redirects invalid sessions to /login */
    }
  }
  const hub = NAV_HUBS.find((h) => h.key === 'settings')
  const first = hub ? visibleTabs(hub, role)[0] : undefined
  redirect(first?.href ?? '/dashboard')
}
