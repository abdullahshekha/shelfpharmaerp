'use client'

import { useEffect, useState } from 'react'

export interface CurrentUser {
  id: string
  name: string
  role: string
}

/** Fetches the logged-in session user once on mount. `user` stays null until loaded. */
export function useCurrentUser(): { user: CurrentUser | null; loading: boolean } {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(j => setUser(j.data ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  return { user, loading }
}
