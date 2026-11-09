import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { getUserFromRequest } from '@/lib/utils/auth'
import { ASSIGN_ACTOR_ROLES, ASSIGNEE_ROLES } from '@/lib/deliveries/assign-rules'
import { DELIVERY_PICTURE_FOLDER, PICTURE_BUCKET } from '@/lib/deliveries/picture'

export const dynamic = 'force-dynamic'

// Proof-of-payment / cheque pictures for delivery outcomes. Same Supabase Storage pattern as
// app/api/retailers/upload-photo (Vercel's filesystem is read-only), stored under delivery/ in the public bucket.
const BUCKET = PICTURE_BUCKET
// Vercel rejects request bodies above ~4.5 MB before they reach the function; keep under it with a clear message.
const MAX_BYTES = 4 * 1024 * 1024
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}
const ROLES: readonly string[] = [...ASSIGN_ACTOR_ROLES, ...ASSIGNEE_ROLES]

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user.id || !ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Photo storage is not configured yet' }, { status: 503 })
  }

  let file: File | null
  try {
    const form = await req.formData()
    const f = form.get('file') ?? form.get('photo')
    file = f instanceof File ? f : null
  } catch {
    return NextResponse.json({ error: 'Send the picture as multipart form data' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'No picture provided' }, { status: 400 })
  const ext = EXT_BY_TYPE[file.type]
  if (!ext) return NextResponse.json({ error: 'Only JPEG, PNG, WebP or HEIC pictures are accepted' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'The picture is empty' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The picture is larger than 4 MB' }, { status: 413 })

  try {
    const filename = `${DELIVERY_PICTURE_FOLDER}/${Date.now()}_${randomBytes(6).toString('hex')}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const supabase = createClient(supabaseUrl, serviceKey)
    const { error } = await supabase.storage.from(BUCKET).upload(filename, buffer, { contentType: file.type })
    if (error) {
      console.error('[deliveries/upload-picture]', error)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename)
    return NextResponse.json({ url: data.publicUrl }, { status: 201 })
  } catch (e) {
    console.error('[deliveries/upload-picture]', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
