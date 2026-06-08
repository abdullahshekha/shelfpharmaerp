import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createHmac } from 'crypto'
import { ErpShell } from './shell'

function decodeSession(cookie: string, secret: string) {
  try {
    const dot = cookie.lastIndexOf('.')
    if (dot === -1) return null
    const payload = cookie.slice(0, dot)
    const sig = cookie.slice(dot + 1)
    const expected = createHmac('sha256', secret).update(payload).digest('base64url')
    if (sig !== expected) return null
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
  } catch {
    return null
  }
}

export default async function ErpLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const token = cookieStore.get('sp_session')?.value
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret-2026'

  if (!token) redirect('/login')

  const session = decodeSession(token, secret)
  if (!session) redirect('/login')

  return (
    <ErpShell role={session.role ?? 'ADMIN'}>
      {children}
    </ErpShell>
  )
}
