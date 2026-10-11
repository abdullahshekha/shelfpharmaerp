'use client'

import { Factory } from 'lucide-react'
import { ReferenceListManager } from '@/components/shared/ReferenceListManager'

export default function ManufacturersSettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manufacturers</h1>
        <p className="text-slate-500 text-sm mt-1">Pharma companies that medicines are assigned to</p>
      </div>
      <ReferenceListManager
        title="Manufacturers"
        icon={<Factory size={16} className="text-purple-500" />}
        apiPath="/api/manufacturers"
        addPlaceholder="New manufacturer name (e.g. ABBOTT LABORATORIES)"
        withContact
        countField="medicineCount"
        countLabel={(n) => `${n} medicine${n !== 1 ? 's' : ''}`}
      />
    </div>
  )
}
