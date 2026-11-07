/** Attempted login names come from a public endpoint: always a string, never longer than 64 chars. */
export function boundedUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.slice(0, 64) : raw == null ? '' : String(raw).slice(0, 64)
}
