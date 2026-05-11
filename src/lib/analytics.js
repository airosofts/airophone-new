// Product analytics for the app portal. Identifies the user once signed in
// so events from the landing page (anonymous) and the app (identified) link.

import posthog from 'posthog-js'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'
const ATTRIBUTION_STORAGE_KEY = 'airo_attribution'

let initialized = false

export function initAnalytics() {
  if (initialized || typeof window === 'undefined') return
  if (POSTHOG_KEY) {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: false,
      person_profiles: 'identified_only',
    })
  }
  initialized = true
}

export function identifyUser(user) {
  if (!POSTHOG_KEY || !user?.userId) return
  const attribution = getStoredAttribution() || {}
  posthog.identify(user.userId, {
    email: user.email,
    workspace_id: user.workspaceId,
    role: user.role,
    ...attribution, // attaches first-touch utm_* to the person
  })
}

export function resetIdentity() {
  if (!POSTHOG_KEY) return
  posthog.reset()
}

export function trackPageview() {
  if (!POSTHOG_KEY || typeof window === 'undefined') return
  posthog.capture('$pageview', { $current_url: window.location.href })
}

export function trackEvent(name, props = {}) {
  if (!POSTHOG_KEY) return
  posthog.capture(name, props)
}

export function getStoredAttribution() {
  if (typeof window === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(ATTRIBUTION_STORAGE_KEY) || 'null') }
  catch { return null }
}

export function clearStoredAttribution() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(ATTRIBUTION_STORAGE_KEY) } catch {}
}
