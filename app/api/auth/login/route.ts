import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createSession } from '@/lib/utils/auth'
import { logLoginEvent } from '@/lib/audit/log'
import { actorFromStaffSession } from '@/lib/audit/actor'
import { boundedUsername } from '@/lib/audit/username'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()
  const attempted = boundedUsername(username) // public endpoint: bound what is written to the audit log
  const secret = process.env.AUTH_SECRET ?? 'shelfpharma-erp-secret-2026'

  // Env-based admin fallback (always works)
  const envUser = process.env.AUTH_USERNAME ?? 'admin'
  const envPass = process.env.AUTH_PASSWORD ?? 'shelfpharma123'
  if (username === envUser && password === envPass) {
    await logLoginEvent({
      action: 'LOGIN', model: 'Employee',
      actor: actorFromStaffSession({ id: 'env-admin', name: 'Admin', role: 'ADMIN' }),
      changes: { username: attempted },
    })
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
    select: { id: true, name: true, role: true, passwordHash: true, loginBlocked: true },
  })

  // Audit failures: the actor is the system (nobody is authenticated); the attempted username is recorded, never the password.
  const failed = (reason: 'invalid' | 'blocked') => logLoginEvent({
    action: 'LOGIN_FAILED', model: 'Employee', recordId: employee?.id ?? null,
    changes: { username: attempted, reason },
  })

  if (!employee || !employee.passwordHash) {
    await failed('invalid')
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  if (employee.loginBlocked) {
    await failed('blocked')
    return NextResponse.json({ error: 'This account is blocked from logging in' }, { status: 403 })
  }

  const hash = hashPassword(password)
  if (hash !== employee.passwordHash) {
    await failed('invalid')
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  await logLoginEvent({
    action: 'LOGIN', model: 'Employee', recordId: employee.id,
    actor: actorFromStaffSession({ id: employee.id, name: employee.name, role: employee.role }),
    changes: { username: attempted },
  })

  const token = createSession({ id: employee.id, name: employee.name, role: employee.role }, secret)
  const res = NextResponse.json({ success: true, role: employee.role })
  res.cookies.set('sp_session', token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7,
  })
  return res
}
