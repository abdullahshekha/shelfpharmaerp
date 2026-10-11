import { redirect } from 'next/navigation'

// Approvals moved to Settings > Approvals; keep the old URL working for bookmarks
export default function ApprovalsRedirect() {
  redirect('/settings/approvals')
}
