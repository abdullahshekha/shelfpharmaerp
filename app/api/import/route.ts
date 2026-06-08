import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Papa from 'papaparse'
import path from 'path'
import fs from 'fs'

interface MedicineRow {
  code: string
  name: string
  manufacturer: string
  category: string
  trade_price: string
  offer_percent: string
  bonus_qty: string
  bonus_note: string
}

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const csvPath = path.join(process.cwd(), '..', 'medicines.csv')
    console.log('[import] Looking for CSV at:', csvPath)

    if (!fs.existsSync(csvPath)) {
      return NextResponse.json({
        error: `medicines.csv not found. Looked at: ${csvPath}`,
      }, { status: 404 })
    }

    const csvText = fs.readFileSync(csvPath, 'utf-8')

    const { data } = Papa.parse<MedicineRow>(csvText, {
      header: true,
      skipEmptyLines: true,
    })

    // Collect unique manufacturer names
    const manufacturerNameSet = new Set<string>()
    for (const r of data) {
      const n = r.manufacturer?.trim()
      if (n) manufacturerNameSet.add(n)
    }
    const manufacturerNames = Array.from(manufacturerNameSet)

    // Upsert all manufacturers
    const manufacturerMap = new Map<string, string>()
    for (const name of manufacturerNames) {
      const m = await prisma.manufacturer.upsert({
        where: { name },
        update: {},
        create: { name },
      })
      manufacturerMap.set(name, m.id)
    }

    // Upsert medicines
    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (const row of data) {
      try {
        const code = row.code?.trim()
        const name = row.name?.trim()
        const mfgName = row.manufacturer?.trim()

        if (!code || !name || !mfgName) {
          skipped++
          continue
        }

        const manufacturerId = manufacturerMap.get(mfgName)
        if (!manufacturerId) {
          errors.push(`Manufacturer not found for medicine ${code}: ${mfgName}`)
          skipped++
          continue
        }

        const tradePrice = parseFloat(row.trade_price) || 0

        await prisma.medicine.upsert({
          where: { code },
          update: {
            name,
            manufacturerId,
            category: row.category?.trim() || null,
            tradePrice,
            bonusQty: row.bonus_qty?.trim() || null,
            bonusNote: row.bonus_note?.trim() || null,
          },
          create: {
            code,
            name,
            manufacturerId,
            category: row.category?.trim() || null,
            tradePrice,
            bonusQty: row.bonus_qty?.trim() || null,
            bonusNote: row.bonus_note?.trim() || null,
          },
        })
        imported++
      } catch (e) {
        errors.push(`Row ${row.code}: ${e instanceof Error ? e.message : String(e)}`)
        skipped++
      }
    }

    return NextResponse.json({
      imported,
      manufacturers: manufacturerNames.length,
      skipped,
      errors,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Import failed' },
      { status: 500 }
    )
  }
}
