import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY ?? ''
  return NextResponse.json({
    keySet: key.length > 0,
    keyLength: key.length,
    keyPrefix: key.slice(0, 20),
    keySuffix: key.slice(-6),
    hasQuotes: key.startsWith('"') || key.startsWith("'"),
  })
}
