import { headers } from 'next/headers'

export type AuditActor = { type: 'EMPLOYEE' | 'CUSTOMER' | 'SYSTEM'; id: string | null; name: string; role: string | null }

export const ACTOR_HEADER = 'x-sp-actor'

const SYSTEM_ACTOR = (): AuditActor => ({ type: 'SYSTEM', id: null, name: 'script', role: null })

// Edge-safe (no Buffer): base64url of UTF-8 JSON.
export function encodeActor(a: AuditActor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(a))
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeActor(h: string | null | undefined): AuditActor {
  if (!h) return SYSTEM_ACTOR()
  try {
    const b64 = h.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (h.length % 4)) % 4)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const o = JSON.parse(new TextDecoder().decode(bytes))
    if (!o || !['EMPLOYEE', 'CUSTOMER', 'SYSTEM'].includes(o.type) || typeof o.name !== 'string') return SYSTEM_ACTOR()
    return {
      type: o.type,
      id: typeof o.id === 'string' ? o.id : null,
      name: o.name,
      role: typeof o.role === 'string' ? o.role : null,
    }
  } catch {
    return SYSTEM_ACTOR()
  }
}

export function getCurrentActor(): AuditActor {
  try {
    return decodeActor(headers().get(ACTOR_HEADER))
  } catch {
    return SYSTEM_ACTOR()
  }
}

export function actorFromStaffSession(s: { id: string; name: string; role: string }): AuditActor {
  if (s.id === 'env-admin') return { type: 'EMPLOYEE', id: null, name: 'admin (env)', role: 'ADMIN' }
  return { type: 'EMPLOYEE', id: s.id, name: s.name, role: s.role }
}

/** Request headers to forward: any client-supplied actor header is always removed, then set only for a verified actor. */
export function buildForwardHeaders(incoming: Headers, actor: AuditActor | null): Headers {
  const h = new Headers(incoming)
  h.delete(ACTOR_HEADER)
  if (actor) h.set(ACTOR_HEADER, encodeActor(actor))
  return h
}
