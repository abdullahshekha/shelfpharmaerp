import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const BUCKET = 'retailer-photos'

// Vercel's serverless functions have a read-only filesystem (aside from /tmp), so writing
// uploads to public/uploads/* — the pattern used for local dev/WhatsApp images — never works in
// production. This uploads to Supabase Storage instead, which requires NEXT_PUBLIC_SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY to be set and a public "retailer-photos" bucket to exist.
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Photo storage is not configured yet — add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and create a public "retailer-photos" bucket in Supabase Storage' },
      { status: 503 }
    )
  }

  try {
    const formData = await req.formData()
    const file = formData.get('photo') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No photo provided' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const filename = `store_${Date.now()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const supabase = createClient(supabaseUrl, serviceKey)
    const { error } = await supabase.storage.from(BUCKET).upload(filename, buffer, {
      contentType: file.type || 'image/jpeg',
    })
    if (error) {
      console.error('[retailers/upload-photo]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename)
    return NextResponse.json({ data: { url: data.publicUrl } }, { status: 201 })
  } catch (e) {
    console.error('[retailers/upload-photo]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload failed' }, { status: 500 })
  }
}
