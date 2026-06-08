'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Calendar } from 'lucide-react'

export interface DateRange {
  from: string   // YYYY-MM-DD
  to: string     // YYYY-MM-DD
  label: string
}

interface Props {
  value: DateRange | null
  onChange: (range: DateRange) => void
  className?: string
}

type Preset = 'today' | 'yesterday' | 'past3' | 'week' | 'month' | 'custom'

function karachiNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }))
}

function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildRange(preset: Preset, customFrom = '', customTo = ''): DateRange | null {
  const now = karachiNow()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (preset) {
    case 'today':
      return { from: fmt(today), to: fmt(today), label: 'Today' }
    case 'yesterday': {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      return { from: fmt(y), to: fmt(y), label: 'Yesterday' }
    }
    case 'past3': {
      const d = new Date(today)
      d.setDate(d.getDate() - 2)
      return { from: fmt(d), to: fmt(today), label: 'Past 3 Days' }
    }
    case 'week': {
      const dow = today.getDay()
      const mon = new Date(today)
      mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
      return { from: fmt(mon), to: fmt(today), label: 'This Week' }
    }
    case 'month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: fmt(first), to: fmt(today), label: 'This Month' }
    }
    case 'custom':
      if (!customFrom || !customTo) return null
      return { from: customFrom, to: customTo, label: `${customFrom} → ${customTo}` }
  }
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'past3',     label: 'Past 3 Days' },
  { key: 'week',      label: 'This Week' },
  { key: 'month',     label: 'This Month' },
  { key: 'custom',    label: 'Custom Range' },
]

export function DateRangePicker({ value, onChange, className = '' }: Props) {
  const [active, setActive] = useState<Preset | null>(null)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]   = useState('')

  const currentPreset: Preset | null = (() => {
    if (!value) return null
    const match = PRESETS.find(p => p.label === value.label)
    return match ? match.key : 'custom'
  })()

  const select = (preset: Preset) => {
    setActive(preset)
    if (preset !== 'custom') {
      const range = buildRange(preset)
      if (range) onChange(range)
    }
  }

  const applyCustom = () => {
    if (!customFrom || !customTo) return
    const range = buildRange('custom', customFrom, customTo)
    if (range) onChange(range)
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Preset pills */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <Calendar size={14} className="text-slate-400 mr-0.5" />
        {PRESETS.map(({ key, label }) => {
          const isActive = currentPreset === key || active === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => select(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400 hover:text-blue-600'
              }`}
            >
              {label}
            </button>
          )
        })}

        {/* Show selected range label when not custom */}
        {value && currentPreset !== 'custom' && (
          <span className="text-xs text-slate-400 ml-1">
            {value.from === value.to ? value.from : `${value.from} → ${value.to}`}
          </span>
        )}
      </div>

      {/* Custom range inputs — shown when custom is active */}
      {(active === 'custom' || currentPreset === 'custom') && (
        <div className="flex items-center gap-2 pl-5">
          <Input
            type="date"
            className="h-8 text-sm w-36"
            value={customFrom}
            max={customTo || undefined}
            onChange={e => { setCustomFrom(e.target.value); if (customTo && e.target.value) applyCustom() }}
          />
          <span className="text-slate-400 text-sm">→</span>
          <Input
            type="date"
            className="h-8 text-sm w-36"
            value={customTo}
            min={customFrom || undefined}
            onChange={e => { setCustomTo(e.target.value); if (customFrom && e.target.value) {
              const range = buildRange('custom', customFrom, e.target.value)
              if (range) onChange(range)
            }}}
          />
        </div>
      )}
    </div>
  )
}
