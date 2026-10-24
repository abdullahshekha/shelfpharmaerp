'use client'

import { useEffect } from 'react'

// Text-like input types where Enter should move focus to the next field instead of
// doing nothing (or submitting the form early). Deliberately excludes checkbox/radio/
// file/submit/button/range, and native <select>/textarea/[role=combobox] (Radix Select
// triggers) which already have their own Enter behavior that this must not hijack.
const NEXT_FIELD_TYPES = new Set([
  'text', 'search', 'email', 'tel', 'url', 'password', 'number', 'date', 'datetime-local', 'time', 'month', 'week',
])

const FIELD_SELECTOR = 'input, textarea, select, [role="combobox"]'

export function EnterKeyNavigation() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const target = e.target as HTMLElement | null
      if (!target || target.tagName !== 'INPUT') return
      const type = (target as HTMLInputElement).type
      if (!NEXT_FIELD_TYPES.has(type)) return
      // Grids/lists with their own Enter handling (see lib/ui/grid-enter.ts) opt out with data-grid-enter.
      if (target.closest('[data-grid-enter]')) return

      const scope = target.closest('form') ?? document.body
      const fields = Array.from(scope.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(
        (el) => !(el as HTMLInputElement).disabled && el.tabIndex !== -1 && el.offsetParent !== null
      )
      const index = fields.indexOf(target)
      if (index === -1) return
      const next = fields[index + 1]
      if (!next) return

      e.preventDefault()
      next.focus()
      if (next.tagName === 'INPUT' || next.tagName === 'TEXTAREA') {
        ;(next as HTMLInputElement).select?.()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return null
}
