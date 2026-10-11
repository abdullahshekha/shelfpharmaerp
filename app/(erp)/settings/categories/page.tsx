'use client'

import { Tags } from 'lucide-react'
import { ReferenceListManager } from '@/components/shared/ReferenceListManager'

export default function CategoriesSettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Categories</h1>
        <p className="text-slate-500 text-sm mt-1">Medicine categories used for filtering and reporting</p>
      </div>
      <ReferenceListManager
        title="Categories"
        icon={<Tags size={16} className="text-emerald-500" />}
        apiPath="/api/categories"
        addPlaceholder="New category name (e.g. Tablet, Syrup)"
        countField="medicineCount"
        countLabel={(n) => `${n} medicine${n !== 1 ? 's' : ''}`}
      />
    </div>
  )
}
