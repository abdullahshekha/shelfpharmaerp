import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PORTAL_COOKIE } from '@/lib/utils/portal-auth'
import { getPortalCustomer } from '@/lib/portal/session'
import { PortalShell } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value
  const customer = await getPortalCustomer(token)
  if (!customer) redirect('/portal/login')
  return <PortalShell customerName={customer.name}>{children}</PortalShell>
}
