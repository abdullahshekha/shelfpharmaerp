import { prisma } from '@/lib/prisma'

/** Next unique 6-digit medicine SKU code, continuing the existing numbering sequence. */
export async function generateMedicineCode(): Promise<string> {
  const medicines = await prisma.medicine.findMany({
    select: { code: true },
    where: { code: { not: { contains: '-' } } },
  })

  let max = 0
  for (const m of medicines) {
    const n = parseInt(m.code, 10)
    if (Number.isFinite(n) && n > max) max = n
  }

  let candidate = max + 1
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = String(candidate).padStart(6, '0')
    const existing = await prisma.medicine.findUnique({ where: { code } })
    if (!existing) return code
    candidate++
  }

  // Fallback — should never happen given the loop above, but guarantees uniqueness.
  return `${Date.now()}`.slice(-6)
}
