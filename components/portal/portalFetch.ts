/** GET helper for portal pages: a 401 sends the customer to the login page; any other failure throws. */
export async function portalGetJson<T = any>(url: string): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(url)
  if (res.status === 401) {
    window.location.href = '/portal/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}
