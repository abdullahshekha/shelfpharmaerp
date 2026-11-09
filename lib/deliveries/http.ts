// Maps errors thrown by the delivery functions (assign.ts, outcome.ts) to HTTP responses for the delivery routes.
import { NextResponse } from 'next/server'
import { AccountingError } from '@/lib/accounting/core'
import { ChequeError } from '@/lib/pdc/create'
import { AssignError } from './assign-rules'
import { OutcomeError } from './outcome-rules'
import { AckError } from './acknowledge-rules'

/** Pure: the status/body for a known error, or null for an unexpected one (a 500). */
export function deliveryErrorBody(e: unknown): { status: number; body: Record<string, unknown> } | null {
  if (e instanceof OutcomeError) return { status: e.status, body: { error: e.message, ...e.extra } }
  if (e instanceof ChequeError) return { status: e.status, body: { error: e.message, ...e.extra } }
  if (e instanceof AssignError || e instanceof AccountingError || e instanceof AckError) return { status: e.status, body: { error: e.message } }
  const err = e as { code?: string; message?: string; meta?: { code?: string } } | null
  const code = err?.code
  const msg = typeof err?.message === 'string' ? err.message : ''
  // Deadlock / serialization failure (Prisma P2034, or Postgres 40P01/40001 surfaced through a raw query): safe to retry.
  if (code === 'P2034' || err?.meta?.code === '40P01' || err?.meta?.code === '40001' || /\b40P01\b|deadlock detected|could not serialize/i.test(msg)) {
    return { status: 409, body: { error: 'Another change to this delivery happened at the same time, please retry' } }
  }
  // A random document number collided with an existing one (unique constraint): retrying draws a new one.
  if (code === 'P2002') return { status: 409, body: { error: 'Please retry' } }
  // Transaction could not start / expired: the database is busy.
  if (code === 'P2028') return { status: 503, body: { error: 'The server is busy, please retry' } }
  // A record used by the request was deleted meanwhile.
  if (code === 'P2025') return { status: 404, body: { error: 'Not found' } }
  return null
}

export function deliveryErrorResponse(e: unknown, where: string): NextResponse {
  const mapped = deliveryErrorBody(e)
  if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
  console.error(where, e)
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
}
