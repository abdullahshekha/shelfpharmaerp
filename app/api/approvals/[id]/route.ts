import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { action, reviewNote } = await req.json() // action: 'APPROVE' | 'REJECT'
  const { id: reviewerId, role } = getUserFromRequest(req)

  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Only Admin can approve/reject deletions' }, { status: 403 })
  }

  const approval = await prisma.deleteApproval.findUnique({ where: { id } })
  if (!approval || approval.status !== 'PENDING') {
    return NextResponse.json({ error: 'Approval not found or already resolved' }, { status: 404 })
  }

  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'

  await prisma.deleteApproval.update({
    where: { id },
    data: { status: newStatus, reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: reviewNote ?? null },
  })

  if (action === 'APPROVE') {
    // Perform the actual deletion
    try {
      switch (approval.model) {
        case 'Order':
          await prisma.order.update({ where: { id: approval.recordId }, data: { status: 'CANCELLED' } })
          break
        case 'Invoice':
          await prisma.invoice.update({ where: { id: approval.recordId }, data: { status: 'DRAFT' } })
          break
        case 'Retailer':
          await prisma.retailer.update({ where: { id: approval.recordId }, data: { isActive: false } })
          break
        case 'Medicine':
          await prisma.medicine.update({ where: { id: approval.recordId }, data: { isActive: false } })
          break
      }
    } catch {
      // Record may already be gone — ignore
    }
  }

  // Notify the requester
  await prisma.notification.create({
    data: {
      employeeId: approval.requestedById,
      type: action === 'APPROVE' ? 'DELETE_APPROVED' : 'DELETE_REJECTED',
      title: action === 'APPROVE' ? 'Delete Request Approved' : 'Delete Request Rejected',
      message: `Your request to delete ${approval.model} "${approval.recordLabel}" was ${newStatus.toLowerCase()}.${reviewNote ? ` Note: ${reviewNote}` : ''}`,
      referenceId: id,
    },
  })

  return NextResponse.json({ success: true, status: newStatus })
}
