// Session validation and migration utility
import { getCurrentUser } from './auth'

/**
 * Validates if the current session has workspace context.
 * If missing workspaceId, attempts to upgrade from DB.
 * Never forces logout — just returns null on failure so callers can decide.
 */
export async function validateAndUpgradeSession() {
  if (typeof window === 'undefined') return null

  const user = getCurrentUser()
  if (!user) return null

  // Session is valid if it has a workspaceId (messagingProfileId can be null for new workspaces)
  if (user.workspaceId) {
    return user
  }

  // Missing workspaceId — try to upgrade via API instead of direct Supabase query
  console.warn('Session missing workspace context — attempting upgrade...')

  try {
    const res = await fetch('/api/auth/session-upgrade', {
      headers: {
        'x-user-id': user.userId,
      },
    })

    if (!res.ok) {
      console.error('Session upgrade failed:', res.status)
      return null
    }

    const data = await res.json()

    if (!data.success || !data.session) {
      console.error('No workspace found for user')
      return null
    }

    // Merge upgraded fields into existing session
    const upgradedSession = { ...user, ...data.session }
    localStorage.setItem('user_session', JSON.stringify(upgradedSession))

    console.log('Session upgraded successfully')
    return upgradedSession
  } catch (error) {
    console.error('Session upgrade error:', error)
    return null
  }
}

/**
 * Check if session is valid (has workspace context)
 */
export function isSessionValid() {
  const user = getCurrentUser()
  return user && user.workspaceId
}
