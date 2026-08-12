'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2 } from 'lucide-react'

export interface DrugLicenseForm {
  licenseNumber: string
  formNumber: string
  expiryDate: string
}

interface Props {
  licenses: DrugLicenseForm[]
  onChange: (licenses: DrugLicenseForm[]) => void
  inputClassName?: string
}

export function DrugLicensesEditor({ licenses, onChange, inputClassName = '' }: Props) {
  const update = (i: number, patch: Partial<DrugLicenseForm>) =>
    onChange(licenses.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const remove = (i: number) => onChange(licenses.filter((_, idx) => idx !== i))

  const add = () => onChange([...licenses, { licenseNumber: '', formNumber: '', expiryDate: '' }])

  return (
    <div className="col-span-2 space-y-2">
      <Label className="text-xs">Drug Licenses</Label>
      {licenses.map((l, i) => (
        <div key={i} className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            {i === 0 && <Label className="text-[11px] text-slate-400">License #</Label>}
            <Input
              className={inputClassName} placeholder="License #"
              value={l.licenseNumber} onChange={e => update(i, { licenseNumber: e.target.value })}
            />
          </div>
          <div className="flex-1 space-y-1">
            {i === 0 && <Label className="text-[11px] text-slate-400">Form #</Label>}
            <Input
              className={inputClassName} placeholder="Form #"
              value={l.formNumber} onChange={e => update(i, { formNumber: e.target.value })}
            />
          </div>
          <div className="flex-1 space-y-1">
            {i === 0 && <Label className="text-[11px] text-slate-400">Expiry</Label>}
            <Input
              className={inputClassName} type="date"
              value={l.expiryDate} onChange={e => update(i, { expiryDate: e.target.value })}
            />
          </div>
          <Button type="button" variant="ghost" size="icon" className="text-red-400 hover:text-red-600 shrink-0" onClick={() => remove(i)}>
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={add}>
        <Plus size={14} /> Add License
      </Button>
    </div>
  )
}
