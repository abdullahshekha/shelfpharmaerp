import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ data: user })
}
