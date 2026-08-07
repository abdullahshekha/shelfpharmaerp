import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/prisma'
import { extractOrderFromImage, ExtractedItem } from '@/lib/claude/extract-order'
import { buildFuseIndex, fuzzyMatchMedicine } from '@/lib/utils/fuzzy-match'
import { getEffectivePrice } from '@/lib/utils/pricing'

export const dynamic = 'force-dynamic'

const BUCKET = 'whatsapp-images'

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Image storage is not configured yet — add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and create a public "whatsapp-images" bucket in Supabase Storage' },
      { status: 503 }
    )
  }

  try {
    const formData = await req.formData()
    const file = formData.get('image') as File | null
    const phoneNumber = (formData.get('phoneNumber') as string) || 'MANUAL'

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 })
    }

    // Vercel's serverless functions have a read-only filesystem outside /tmp, so this
    // uploads to Supabase Storage instead of public/uploads/whatsapp/ — see vercel-serverless-storage memory.
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const filename = `wa_${Date.now()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const supabase = createClient(supabaseUrl, serviceKey)
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filename, buffer, {
      contentType: file.type || 'image/jpeg',
    })
    if (uploadError) {
      console.error('[whatsapp/process-image] upload', uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }
    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(filename)
    const imageUrl = publicUrlData.publicUrl

    // Convert to base64 for Claude
    const base64 = buffer.toString('base64')
    const mimeMap: Record<string, 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    }
    const mediaType = mimeMap[ext] ?? 'image/jpeg'

    // Run Claude OCR — let errors propagate so the user sees them
    let extractedItems: ExtractedItem[] = []
    extractedItems = await extractOrderFromImage(base64, mediaType)
    const rawOcrText = JSON.stringify(extractedItems)

    // Load all medicines for fuzzy matching
    const medicines = await prisma.medicine.findMany({
      where: { isActive: true },
      select: {
        id: true, code: true, name: true, genericName: true, category: true,
        batches: { select: { currentQty: true, expiryDate: true, tradePrice: true, mrp: true } },
      },
    })

    buildFuseIndex(medicines.map(m => ({
      id: m.id,
      code: m.code,
      name: m.name,
      genericName: m.genericName,
      tradePrice: getEffectivePrice(m.batches).tradePrice,
      category: m.category,
    })))

    // Fuzzy-match each extracted item
    const withMatches = extractedItems.map(item => {
      const matches = fuzzyMatchMedicine(item.cleanedName)
      return {
        ...item,
        matches,
        matchedMedicineId: matches[0]?.confidence === 'high' ? matches[0].medicine.id : null,
        confidence: matches[0]?.score ?? 0,
      }
    })

    // Try to match retailer by phone number
    let retailerId: string | null = null
    if (phoneNumber !== 'MANUAL') {
      const retailer = await prisma.retailer.findFirst({
        where: { whatsappNumber: { contains: phoneNumber.replace(/\D/g, '').slice(-10) } },
      })
      retailerId = retailer?.id ?? null
    }

    // Create WhatsappOrder record
    const waOrder = await prisma.whatsappOrder.create({
      data: {
        phoneNumber,
        retailerId,
        imageUrl,
        rawOcrText,
        extractedItems: JSON.stringify(withMatches),
        status: 'AI_PROCESSED',
      },
    })

    return NextResponse.json({ data: { id: waOrder.id, itemCount: withMatches.length } }, { status: 201 })
  } catch (e) {
    console.error('[process-image]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Processing failed' }, { status: 500 })
  }
}
