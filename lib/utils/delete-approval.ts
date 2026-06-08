import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest, canDeleteDirectly, canRequestDelete } from './auth'

export async function handleDelete(
  req: NextRequest,
  model: string,
  recordId: string,
  recordLabel: string,
  deleteFn: () => Promise<void>
): Promise<NextResponse> {
  const { role, id: requesterId } = getUserFromRequest(req)

  if (canDeleteDirectly(role)) {
    await deleteFn()
    return NextResponse.json({ success: true })
  }

  if (canRequestDelete(role) && requesterId) {
    const approval = await prisma.deleteApproval.create({
      data: { requestedById: requesterId, model, recordId, recordLabel, status: 'PENDING' },
    })

    // Notify all active admins
    const admins = await prisma.employee.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    })
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map(a => ({
          employeeId: a.id,
          type: 'DELETE_APPROVAL_REQUEST',
          title: `Delete Request — ${model}`,
          message: `Manager requested deletion of: ${recordLabel}`,
          referenceId: approval.id,
        })),
      })
    }

    return NextResponse.json(
      { pending: true, message: 'Delete request submitted for admin approval.', approvalId: approval.id },
      { status: 202 }
    )
  }

  return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
}
