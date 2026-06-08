import Anthropic from '@anthropic-ai/sdk'

export interface ExtractedItem {
  rawName: string
  cleanedName: string
  quantity: number
  unit: 'strip' | 'bottle' | 'tube' | 'sachet' | 'unknown'
  dosage: string | null
  form: 'tablet' | 'syrup' | 'capsule' | 'cream' | 'drops' | 'sachet' | 'unknown'
}

const SYSTEM = `You are an expert at reading handwritten medicine order lists from pharmacy retailers in Karachi, Pakistan. You have deep knowledge of Pakistani brand-name medicines, their abbreviations, and local pharma trade conventions.`

const PROMPT = `Read this handwritten medicine order image carefully and extract every medicine with its quantity.

READING RULES — apply all of these:

1. QUANTITY NOTATIONS:
   - A number written inside a circle after the name (e.g. ③) = quantity is that number
   - "T" or "Ti" written BEFORE a name = quantity 1 strip (e.g. "Ti Augmentin" = Augmentin qty 1)
   - A plain number written after the name = that is the quantity (e.g. "Nappy Rash Cream 2" = qty 2)
   - "½" = 0.5, write as 1 if half-strip makes no sense
   - "1mi", "Imi", "lmi" = quantity 1 (handwritten "1" looks like lowercase L or i)
   - If no quantity found, default to 1

2. FORM ABBREVIATIONS:
   - Syp / Syr / syrup = syrup
   - Tab / tab = tablet
   - Cap / cap = capsule
   - Crm / crm = cream
   - Gel = cream
   - Drp / Drop / drops = drops
   - Sach / Sachet = sachet
   - Inj / INJ = injection

3. CROSSED OUT ITEMS: If a line has a heavy horizontal stroke through it, SKIP it entirely.

4. TWO-COLUMN LAYOUTS: Many orders are written in two columns. Read left column top-to-bottom first, then right column top-to-bottom.

5. MEDICINE NAMES: Names are often abbreviated or phonetically spelled. Examples:
   - "Risek" → RISEK (omeprazole brand)
   - "Augmanton" / "Augmentin 625" → AUGMENTIN 625MG
   - "Digas syp" → DIGESTIN SYRUP
   - "Cebosh" → CEBOSH SYP
   - "Nospa" → NOSPA TAB
   - "Maxit 75mg" → MAXIT 75MG TAB
   - "Septran syp" → SEPTRAN SYRUP
   - "Cal 1000" → CAL-1000
   - Include the dosage strength in cleanedName (e.g. "75mg", "500mg", "20mg")

6. INCLUDE EVERYTHING you can read, even if partially legible. Use "UNCLEAR: ..." prefix for uncertain items.

Return ONLY a JSON array with no explanation, no markdown, no preamble. Start directly with [ and end with ].

Each element:
{
  "rawName": "text exactly as written in the image",
  "cleanedName": "your best medicine name interpretation including strength",
  "quantity": <integer>,
  "unit": "strip" | "bottle" | "tube" | "sachet" | "unknown",
  "dosage": "e.g. 75mg" or null,
  "form": "tablet" | "syrup" | "capsule" | "cream" | "drops" | "sachet" | "unknown"
}`

export async function extractOrderFromImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<ExtractedItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env.local')

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  // Strip markdown fences and any text before the first "[" or after the last "]"
  const cleaned = raw
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()


  // Extract the JSON array — find first "[" to last "]"
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON array found in response: ${raw.slice(0, 300)}`)
  }
  const jsonStr = cleaned.slice(start, end + 1)

  try {
    return JSON.parse(jsonStr) as ExtractedItem[]
  } catch {
    throw new Error(`Failed to parse OCR response: ${jsonStr.slice(0, 300)}`)
  }
}
