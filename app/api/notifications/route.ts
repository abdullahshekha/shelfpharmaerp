import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { id, role } = getUserFromRequest(req)
  if (!id || id === 'env-admin') {
    // env-admin: count pending approvals as notifications
    if (role === 'ADMIN') {
      const count = await prisma.deleteApproval.count({ where: { status: 'PENDING' } })
      return NextResponse.json({ data: [], unreadCount: count })
    }
    return NextResponse.json({ data: [], unreadCount: 0 })
  }

  const { searchParams } = new URL(req.url)
  const unreadOnly = searchParams.get('unread') === 'true'

  const notifications = await prisma.notification.findMany({
    where: { employeeId: id, ...(unreadOnly && { read: false }) },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const unreadCount = await prisma.notification.count({ where: { employeeId: id, read: false } })

  // Also add pending approval count for admins
  let pendingApprovals = 0
  if (role === 'ADMIN') {
    pendingApprovals = await prisma.deleteApproval.count({ where: { status: 'PENDING' } })
  }

  return NextResponse.json({ data: notifications, unreadCount: unreadCount + pendingApprovals })
}

export async function PATCH(req: NextRequest) {
  const { id } = getUserFromRequest(req)
  if (!id || id === 'env-admin') return NextResponse.json({ success: true })

  const { notificationId } = await req.json()
  if (notificationId) {
    await prisma.notification.update({ where: { id: notificationId }, data: { read: true } })
  } else {
    await prisma.notification.updateMany({ where: { employeeId: id }, data: { read: true } })
  }
  return NextResponse.json({ success: true })
}
