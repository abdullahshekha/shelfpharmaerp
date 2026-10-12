/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { requireAccountsUser } from '@/lib/accounting/guard'
import { rebuildChunk, SOURCE_TYPES, type RebuildStep } from '@/lib/accounting/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Chunked, idempotent re-sync of every source dated since go-live. Body (all optional):
// { type?: SourceType | 'ORPHANS', after?: string, limit?: number (default 40, max 100) }. Call again with the returned
// `next` until `done` is true.
export async function POST(req: NextRequest) {
  const auth = requireAccountsUser(req)
  if (auth instanceof NextResponse) return auth

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const type = body?.type as RebuildStep | undefined
  if (type !== undefined && type !== 'ORPHANS' && !SOURCE_TYPES.includes(type as any)) {
    return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
  }
  if (body?.after !== undefined && body.after !== null && typeof body.after !== 'string') {
    return NextResponse.json({ error: 'after must be a string' }, { status: 400 })
  }
  if (body?.limit !== undefined && !(Number.isFinite(Number(body.limit)) && Number(body.limit) > 0)) {
    return NextResponse.json({ error: 'limit must be a positive number' }, { status: 400 })
  }
  // A cursor only makes sense inside a step: `after` without `type` would resume the wrong list.
  if (body?.after && !type) {
    return NextResponse.json({ error: 'after requires type' }, { status: 400 })
  }
  const limit = body?.limit === undefined ? 40 : Math.min(100, Math.floor(Number(body.limit)))
  const report = await rebuildChunk({ type, after: body?.after ?? null, limit })
  return NextResponse.json({ data: report })
}
