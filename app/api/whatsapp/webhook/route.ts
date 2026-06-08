import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extractOrderFromImage } from '@/lib/claude/extract-order'
import { buildFuseIndex, fuzzyMatchMedicine } from '@/lib/utils/fuzzy-match'
import { sendWhatsAppMessage, buildAutoReplyText } from '@/lib/whatsapp/send-message'
import path from 'path'
import fs from 'fs'

export const dynamic = 'force-dynamic'

// Meta webhook verification
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.log('[webhook] Verified')
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// Incoming WhatsApp messages
export async function POST(req: NextRequest) {
  const body = await req.json()

  try {
    const entry = body.entry?.[0]
    const changes = entry?.changes?.[0]
    const value = changes?.value
    const message = value?.messages?.[0]

    if (!message) return NextResponse.json({ status: 'no_message' })

    const phoneNumber = message.from as string
    const messageType = message.type as string

    // Handle "CONFIRM" text replies — find the most recent AI_PROCESSED order for this number
    if (messageType === 'text') {
      const text = (message.text?.body ?? '').trim().toLowerCase()
      if (text === 'confirm' || text === 'yes') {
        const pending = await prisma.whatsappOrder.findFirst({
          where: { phoneNumber, status: 'AUTO_REPLY_SENT' },
          orderBy: { createdAt: 'desc' },
          include: { retailer: true },
        })
        if (pending) {
          await prisma.whatsappOrder.update({ where: { id: pending.id }, data: { status: 'CONFIRMED' } })
          await sendWhatsAppMessage(phoneNumber, `Your order has been confirmed! Our team will process it shortly.\n\n- ShelfPharma Team`)
        }
      }
      return NextResponse.json({ status: 'ok' })
    }

    // Handle image messages
    if (messageType !== 'image') return NextResponse.json({ status: 'ignored' })

    const mediaId = message.image?.id as string
    if (!mediaId) return NextResponse.json({ status: 'no_media_id' })

    // Download image from Meta
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const mediaData = await mediaRes.json()
    const imageRes = await fetch(mediaData.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const buffer = Buffer.from(await imageRes.arrayBuffer())

    // Save image
    const filename = `wa_${Date.now()}.jpg`
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'whatsapp')
    fs.mkdirSync(uploadDir, { recursive: true })
    fs.writeFileSync(path.join(uploadDir, filename), buffer)
    const imageUrl = `/uploads/whatsapp/${filename}`

    // Match retailer
    const normalised = phoneNumber.replace(/\D/g, '').slice(-10)
    const retailer = await prisma.retailer.findFirst({
      where: { whatsappNumber: { contains: normalised } },
    })

    // Run OCR
    let extractedItems: Awaited<ReturnType<typeof extractOrderFromImage>> = []
    try {
      extractedItems = await extractOrderFromImage(buffer.toString('base64'), 'image/jpeg')
    } catch (e) {
      console.error('[webhook] OCR failed:', e)
    }

    // Fuzzy match
    const medicines = await prisma.medicine.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, genericName: true, tradePrice: true, category: true },
    })
    buildFuseIndex(medicines.map(m => ({ ...m, tradePrice: Number(m.tradePrice), genericName: m.genericName })))

    const withMatches = extractedItems.map(item => {
      const matches = fuzzyMatchMedicine(item.cleanedName)
      return { ...item, matches, matchedMedicineId: matches[0]?.confidence === 'high' ? matches[0].medicine.id : null, confidence: matches[0]?.score ?? 0 }
    })

    // Create WhatsApp order
    const waOrder = await prisma.whatsappOrder.create({
      data: {
        phoneNumber,
        retailerId: retailer?.id ?? null,
        imageUrl,
        rawOcrText: JSON.stringify(extractedItems),
        extractedItems: JSON.stringify(withMatches),
        whatsappMessageId: message.id,
        status: 'AI_PROCESSED',
      },
    })

    // Build and send auto-reply if retailer is known
    if (retailer && extractedItems.length > 0) {
      const replyItems = await Promise.all(withMatches.map(async item => {
        const medId = item.matchedMedicineId
        let inStock = false
        let qty = 0
        if (medId) {
          const batches = await prisma.medicineBatch.findMany({ where: { medicineId: medId, currentQty: { gt: 0 } } })
          qty = batches.reduce((s, b) => s + b.currentQty, 0)
          inStock = qty > 0
        }
        return { name: item.cleanedName, inStock, quantity: qty }
      }))

      const replyText = buildAutoReplyText(retailer.name, replyItems)
      const sent = await sendWhatsAppMessage(phoneNumber, replyText)

      await prisma.whatsappOrder.update({
        where: { id: waOrder.id },
        data: { autoReplyText: replyText, autoReplySent: sent, status: sent ? 'AUTO_REPLY_SENT' : 'AI_PROCESSED' },
      })
    }
  } catch (e) {
    console.error('[webhook] Error:', e)
  }

  return NextResponse.json({ status: 'ok' })
}
