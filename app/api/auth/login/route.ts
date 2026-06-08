import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createSession } from '@/lib/utils/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret'

  // Env-based admin fallback (always works)
  const envUser = process.env.AUTH_USERNAME ?? 'admin'
  const envPass = process.env.AUTH_PASSWORD ?? 'shelfpharma123'
  if (username === envUser && password === envPass) {
    const token = createSession({ id: 'env-admin', name: 'Admin', role: 'ADMIN' }, secret)
    const res = NextResponse.json({ success: true, role: 'ADMIN' })
    res.cookies.set('sp_session', token, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
    })
    return res
  }

  // Per-employee login
  const employee = await prisma.employee.findFirst({
    where: { username, isActive: true },
    select: { id: true, name: true, role: true, passwordHash: true },
  })

  if (!employee || !employee.passwordHash) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  const hash = hashPassword(password)
  if (hash !== employee.passwordHash) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  const token = createSession({ id: employee.id, name: employee.name, role: employee.role }, secret)
  const res = NextResponse.json({ success: true, role: employee.role })
  res.cookies.set('sp_session', token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  })
  return res
}
