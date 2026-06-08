export async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) {
    console.log('[WhatsApp] API not configured — would send to', to, ':\n', text)
    return false
  }

  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  })

  if (!res.ok) {
    console.error('[WhatsApp] Send failed:', await res.text())
    return false
  }
  return true
}

export function buildAutoReplyText(
  retailerName: string,
  items: { name: string; inStock: boolean; quantity: number }[]
): string {
  const lines = items.map(i =>
    `${i.inStock ? '✅' : '❌'} ${i.name}${i.inStock ? ` - Available (${i.quantity} strips)` : ' - OUT OF STOCK'}`
  ).join('\n')

  return `Dear ${retailerName},

Thank you for your order. Here is what we have available:

${lines}

Please reply CONFIRM to place this order, or let us know if you want to make changes.

- ShelfPharma Team
0330-7774353`
}
