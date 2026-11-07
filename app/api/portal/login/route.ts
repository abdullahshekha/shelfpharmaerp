import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logLoginEvent } from '@/lib/audit/log'
import {
  PORTAL_COOKIE, PORTAL_COOKIE_OPTIONS, MAX_FAILED_ATTEMPTS, LOCK_MINUTES,
  hashPortalPassword, verifyPortalPassword, createPortalSession, validatePortalUsername,
} from '@/lib/utils/portal-auth'

export const dynamic = 'force-dynamic'

// Verified against when the account is unknown/unusable so response time does not reveal which usernames exist.
const DUMMY_HASH = hashPortalPassword('dummy-password-for-timing')

const invalid = () => NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
const tooMany = () => NextResponse.json({ error: 'Too many attempts, try again later' }, { status: 429 })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const username = validatePortalUsername(body?.username)
  const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : ''

  const r = username
    ? await prisma.retailer.findUnique({
        where: { portalUsername: username },
        select: {
          id: true, name: true, isActive: true, portalEnabled: true, portalPasswordHash: true,
          portalSessionVersion: true, portalLockedUntil: true,
        },
      })
    : null

  // One audit insert per failing branch (known account -> the customer is the actor; unknown -> system). Never the password.
  const attempted = username ?? (typeof body?.username === 'string' ? body.username.slice(0, 64) : null)
  const failed = (reason: 'invalid' | 'blocked' | 'locked') => logLoginEvent({
    action: 'LOGIN_FAILED', model: 'Retailer', recordId: r?.id ?? null,
    actor: r ? { type: 'CUSTOMER', id: r.id, name: r.name, role: null } : undefined,
    changes: { username: attempted, reason },
  })

  // Cheap early exit; the atomic gate below is what actually enforces the lock under concurrency.
  if (r?.portalLockedUntil && r.portalLockedUntil > new Date()) {
    await failed('locked')
    return tooMany()
  }

  const usable = !!r && r.isActive && r.portalEnabled && !!r.portalPasswordHash

  if (!usable) {
    // Mirror the DB round trip real accounts pay for the gate below (matches no row), so response
    // time does not distinguish unknown/disabled accounts from real ones.
    await prisma.retailer.updateMany({
      where: { id: '__timing_noop__' },
      data: { portalFailedAttempts: { increment: 1 } },
    })
    verifyPortalPassword(password, DUMMY_HASH)
    await failed(r ? 'blocked' : 'invalid')
    return invalid()
  }

  // Atomic gate: count this attempt BEFORE verifying. The update only matches while the account is not
  // locked, and the returned counter is unique per concurrent request, so at most MAX_FAILED_ATTEMPTS
  // password verifications can happen per lock window even under a parallel burst.
  let k: number
  try {
    k = (await prisma.retailer.update({
      where: { id: r!.id, OR: [{ portalLockedUntil: null }, { portalLockedUntil: { lt: new Date() } }] },
      data: { portalFailedAttempts: { increment: 1 } },
      select: { portalFailedAttempts: true },
    })).portalFailedAttempts
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      await failed('locked')
      return tooMany() // locked
    }
    throw e
  }
  if (k > MAX_FAILED_ATTEMPTS) {
    await failed('locked')
    return tooMany() // burst overflow: never verified
  }

  const ok = verifyPortalPassword(password, r!.portalPasswordHash!)

  if (!ok) {
    if (k === MAX_FAILED_ATTEMPTS) {
      await prisma.retailer.update({
        where: { id: r!.id },
        data: { portalFailedAttempts: 0, portalLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
      })
      await failed('locked')
      return tooMany()
    }
    await failed('invalid')
    return invalid()
  }

  await prisma.retailer.update({
    where: { id: r!.id },
    data: { portalFailedAttempts: 0, portalLockedUntil: null, portalLastLoginAt: new Date() },
  })

  await logLoginEvent({
    action: 'LOGIN', model: 'Retailer', recordId: r!.id,
    actor: { type: 'CUSTOMER', id: r!.id, name: r!.name, role: null },
    changes: { username },
  })

  const res = NextResponse.json({ success: true })
  res.cookies.set(PORTAL_COOKIE, createPortalSession({ rid: r!.id, v: r!.portalSessionVersion }), PORTAL_COOKIE_OPTIONS)
  return res
}
