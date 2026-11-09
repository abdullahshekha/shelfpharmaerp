'use client'

import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { AckLists } from '@/components/deliveries/AckLists'

// ADMIN/MANAGER only (the API enforces it too).
export default function AcknowledgementsPage() {
  const { user, loading } = useCurrentUser()
  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading...</div>
  if (user?.role !== 'ADMIN' && user?.role !== 'MANAGER') {
    return <div className="p-8 text-slate-500">Only a manager or admin can acknowledge deliveries.</div>
  }
  return <AckLists />
}
