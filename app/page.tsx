import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getUserFromCookie } from '@/lib/utils/auth'
import { landingFor } from '@/lib/nav'

// Send each role to the first screen it can open (a Driver has no Dashboard). Missing role = env admin = ADMIN,
// the same default the ERP layout uses.
export default async function Home() {
  const token = (await cookies()).get('sp_session')?.value
  const session = getUserFromCookie(token)
  if (!session) redirect('/login')
  redirect(landingFor(session.role ?? 'ADMIN') ?? '/login')
}
