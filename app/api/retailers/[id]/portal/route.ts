import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/utils/auth'
import { hashPortalPassword, validatePortalPassword, validatePortalUsername } from '@/lib/utils/portal-auth'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['ADMIN', 'MANAGER']

async function statusFor(id: string) {
  const r = await prisma.retailer.findUnique({
    where: { id },
    select: { portalUsername: true, portalEnabled: true, portalPasswordHash: true, portalLastLoginAt: true, portalLockedUntil: true },
  })
  if (!r) return null
  return {
    portalUsername: r.portalUsername,
    portalEnabled: r.portalEnabled,
    hasPassword: !!r.portalPasswordHash,
    portalLastLoginAt: r.portalLastLoginAt,
    lockedUntil: r.portalLockedUntil && r.portalLockedUntil > new Date() ? r.portalLockedUntil : null,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ALLOWED_ROLES.includes(getUserFromRequest(req).role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const data = await statusFor(id)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ data })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ALLOWED_ROLES.includes(getUserFromRequest(req).role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const raw = (await req.json().catch(() => null)) ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

  const existing = await prisma.retailer.findUnique({
    where: { id },
    select: { portalUsername: true, portalPasswordHash: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: Prisma.RetailerUpdateInput = {}

  if (body.username !== undefined) {
    const username = validatePortalUsername(body.username)
    if (!username) {
      return NextResponse.json({ error: 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore' }, { status: 400 })
    }
    const [dupCustomer, dupEmployee] = await Promise.all([
      prisma.retailer.findFirst({ where: { portalUsername: username, NOT: { id } }, select: { id: true } }),
      prisma.employee.findFirst({ where: { username: { equals: username, mode: 'insensitive' } }, select: { id: true } }),
    ])
    const adminName = (process.env.AUTH_USERNAME ?? 'admin').toLowerCase()
    if (dupCustomer || dupEmployee || username === adminName) {
      return NextResponse.json({ error: 'That username is already in use' }, { status: 409 })
    }
    data.portalUsername = username
  }

  if (body.password !== undefined) {
    if (!validatePortalPassword(body.password)) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    data.portalPasswordHash = hashPortalPassword(body.password)
    data.portalSessionVersion = { increment: 1 } // log the customer out everywhere
    data.portalFailedAttempts = 0
    data.portalLockedUntil = null
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 })
    const enabled = body.enabled
    if (enabled) {
      const hasUsername = !!(data.portalUsername ?? existing.portalUsername)
      const hasPassword = !!(data.portalPasswordHash ?? existing.portalPasswordHash)
      if (!hasUsername || !hasPassword) {
        return NextResponse.json({ error: 'Set a username and password before enabling portal access' }, { status: 400 })
      }
    } else {
      data.portalSessionVersion = { increment: 1 }
    }
    data.portalEnabled = enabled
  }

  try {
    await prisma.retailer.update({ where: { id }, data })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'That username is already in use' }, { status: 409 })
    }
    throw e
  }
  return NextResponse.json({ data: await statusFor(id) })
}
