import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { syncSafe } from '@/lib/accounting/sync'
import { AccountingError } from '@/lib/accounting/core'
import { cancelOrder, hardDeleteOrder } from '@/lib/orders/lifecycle'
import { deleteBatch } from '@/lib/inventory/batch-delete'

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

  // Claim the approval atomically so two concurrent reviews cannot both execute it.
  const claim = await prisma.deleteApproval.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: newStatus, reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: reviewNote ?? null },
  })
  if (claim.count === 0) {
    return NextResponse.json({ error: 'Approval not found or already resolved' }, { status: 404 })
  }

  let warnings: string[] = []
  if (action === 'APPROVE') {
    // Perform the actual deletion — same code paths as the direct (ADMIN) routes.
    try {
      switch (approval.model) {
        case 'Order':
          warnings = (await cancelOrder(approval.recordId)).warnings
          break
        case 'Order-Hard':
          warnings = (await hardDeleteOrder(approval.recordId)).warnings
          break
        case 'Invoice':
          await prisma.invoice.update({ where: { id: approval.recordId }, data: { status: 'DRAFT' } })
          await syncSafe('INVOICE', approval.recordId)
          break
        case 'Retailer':
          await prisma.retailer.update({ where: { id: approval.recordId }, data: { isActive: false } })
          break
        case 'Medicine':
          await prisma.medicine.update({ where: { id: approval.recordId }, data: { isActive: false } })
          break
        case 'MedicineBatch':
          await deleteBatch(approval.recordId, { userId: reviewerId || undefined })
          break
        case 'Employee':
          await prisma.employee.update({ where: { id: approval.recordId }, data: { isActive: false } })
          break
        case 'Supplier':
          await prisma.supplier.update({ where: { id: approval.recordId }, data: { isActive: false } })
          break
      }
    } catch (err) {
      // A refusal (e.g. stock write-off into a locked accounting period) leaves the request pending so it can be
      // approved later. A missing record (404) or any other failure is ignored as before (record may already be gone).
      if (err instanceof AccountingError && err.status !== 404) {
        await prisma.deleteApproval.update({
          where: { id },
          data: { status: 'PENDING', reviewedById: null, reviewedAt: null, reviewNote: null },
        })
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
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

  return NextResponse.json({ success: true, status: newStatus, warnings })
}
