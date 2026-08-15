// Browser-only store for the Path A Supabase token. Kept in module scope so the
// supabase-js `accessToken` callback can read it synchronously on every request.
let currentToken = null
let expiresAt = 0          // epoch ms
let refreshTimer = null
let inFlight = null        // dedupes concurrent refreshes (inbox fires several at once)

export function getSupabaseToken() {
  return currentToken
}

export async function refreshSupabaseToken() {
  // Collapse concurrent callers onto one network request so a reload that fires
  // fetchMessages + fetchCalls + subscriptions doesn't mint several tokens.
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const res = await fetch('/api/auth/supabase-token', { credentials: 'include' })
      if (!res.ok) { currentToken = null; return null }
      const data = await res.json()
      currentToken = data.token
      expiresAt = data.expiresAt
      return currentToken
    } catch {
      currentToken = null
      return null
    }
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

export function startSupabaseTokenRefresh() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
  const schedule = () => {
    // refresh at 80% of remaining lifetime, floor 30s
    const lifetime = Math.max(expiresAt - Date.now(), 0)
    const delay = Math.max(Math.floor(lifetime * 0.8), 30_000)
    refreshTimer = setTimeout(async () => {
      await refreshSupabaseToken()
      schedule()
    }, delay)
  }
  return refreshSupabaseToken().then(() => { schedule() })
}

export function clearSupabaseToken() {
  currentToken = null
  expiresAt = 0
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
}
