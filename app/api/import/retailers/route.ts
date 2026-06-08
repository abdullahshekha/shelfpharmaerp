import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Papa from 'papaparse'

export const dynamic = 'force-dynamic'

interface RetailerRow {
  name: string
  owner_name: string
  phone: string
  whatsapp_number: string
  area: string
  address: string
  drug_license_number: string
  drug_license_expiry: string
  credit_limit: string
  credit_days: string
  notes: string
}

// Accepts either a CSV file upload or a JSON array in the request body
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''

  let rows: RetailerRow[] = []

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    const text = await file.text()
    const { data } = Papa.parse<RetailerRow>(text, { header: true, skipEmptyLines: true })
    rows = data
  } else {
    const body = await req.json()
    rows = body.retailers ?? []
  }

  if (!rows.length) return NextResponse.json({ error: 'No retailer data provided' }, { status: 400 })

  let imported = 0, skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    try {
      const name = row.name?.trim()
      if (!name) { skipped++; continue }

      await prisma.retailer.upsert({
        where: { code: row.phone?.trim() || `IMPORT-${Date.now()}-${Math.random()}` },
        update: {
          name,
          ownerName: row.owner_name?.trim() || null,
          whatsappNumber: row.whatsapp_number?.trim() || null,
          areaId: undefined, // area import requires pre-created Area records
          address: row.address?.trim() || null,
          drugLicenseNumber: row.drug_license_number?.trim() || null,
          drugLicenseExpiry: row.drug_license_expiry ? new Date(row.drug_license_expiry) : null,
          creditLimit: parseFloat(row.credit_limit) || 0,
          creditDays: parseInt(row.credit_days) || 0,
          notes: row.notes?.trim() || null,
        },
        create: {
          code: row.phone?.trim() || null,
          name,
          ownerName: row.owner_name?.trim() || null,
          phone: row.phone?.trim() || null,
          whatsappNumber: row.whatsapp_number?.trim() || null,
          areaId: undefined, // area import requires pre-created Area records
          address: row.address?.trim() || null,
          drugLicenseNumber: row.drug_license_number?.trim() || null,
          drugLicenseExpiry: row.drug_license_expiry ? new Date(row.drug_license_expiry) : null,
          creditLimit: parseFloat(row.credit_limit) || 0,
          creditDays: parseInt(row.credit_days) || 0,
          notes: row.notes?.trim() || null,
        },
      })
      imported++
    } catch (e) {
      errors.push(`Row "${row.name}": ${e instanceof Error ? e.message : String(e)}`)
      skipped++
    }
  }

  return NextResponse.json({ imported, skipped, errors })
}
