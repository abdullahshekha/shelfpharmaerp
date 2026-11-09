// Validates a post-login return path: only same-site paths pass, everything else gets the fallback.
// Rejects backslashes and control characters (browsers strip tabs/newlines and treat "\" as "/", which would
// turn "/\evil.com" or "/<tab>/evil.com" into "//evil.com"), then resolves against a fixed dummy origin.
const DUMMY = 'http://localhost'

export function safeFromPath(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback
  for (let i = 0; i < raw.length; i++) { const c = raw.charCodeAt(i); if (c <= 0x1f || c === 0x7f || c === 0x5c) return fallback }
  try {
    const u = new URL(raw, DUMMY)
    if (u.origin !== DUMMY) return fallback
    const out = u.pathname + u.search + u.hash
    // Dot-segments can collapse into a protocol-relative path ("/..//evil.com" -> "//evil.com"): refuse those.
    return out.startsWith('//') ? fallback : out
  } catch {
    return fallback
  }
}
