import Fuse from 'fuse.js'

export interface MedicineSearchItem {
  id: string
  code: string
  name: string
  genericName?: string | null
  tradePrice: number
  category?: string | null
}

export interface FuzzyMatch {
  medicine: MedicineSearchItem
  score: number
  confidence: 'high' | 'medium' | 'low'
}

let fuse: Fuse<MedicineSearchItem> | null = null

export function buildFuseIndex(medicines: MedicineSearchItem[]) {
  fuse = new Fuse(medicines, {
    keys: [
      { name: 'name', weight: 0.7 },
      { name: 'genericName', weight: 0.3 },
    ],
    includeScore: true,
    threshold: 0.6,
    minMatchCharLength: 2,
    ignoreLocation: true,
  })
}

export function fuzzyMatchMedicine(query: string, limit = 3): FuzzyMatch[] {
  if (!fuse) return []

  const results = fuse.search(query, { limit })

  return results.map((r) => {
    const score = 1 - (r.score ?? 1)
    return {
      medicine: r.item,
      score,
      confidence: score > 0.8 ? 'high' : score > 0.5 ? 'medium' : 'low',
    }
  })
}
