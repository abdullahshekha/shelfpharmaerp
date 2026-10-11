'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Account } from './types'

interface Props {
  accounts: Pick<Account, 'id' | 'code' | 'name'>[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
}

export function AccountSelect({ accounts, value, onChange, placeholder = 'Select account', className = 'w-64 h-8 text-sm' }: Props) {
  const items = accounts.map(a => ({ value: a.id, label: `${a.code} · ${a.name}` }))
  return (
    <Select items={items} value={value || null} onValueChange={v => onChange(v ?? '')}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {items.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
