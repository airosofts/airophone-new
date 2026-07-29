// Google conversion events for the signup funnel (fired client-side).
//
// The base gtag.js tag + GTM container load globally in src/app/layout.js.
// Three layers:
//   1. GA4 events — always fired (importable into Google Ads as conversions).
//   2. Plain dataLayer {event: ...} pushes — gtag()-style entries are NOT
//      visible to GTM custom-event triggers, so we push both shapes.
//   3. Direct Google Ads conversions — send_to ids from the ads manager.
//
// Funnel (per ads-team spec, 2026-07-29):
//   begin_signup      → user lands on /signup
//   start_onboarding  → user reaches /onboarding (account created)
//   signup_completed  → onboarding finished (card + trial) — ONCE per account,
//                       plus the Google Ads conversion (AW-18356615565)
const SIGNUP_SEND_TO = process.env.NEXT_PUBLIC_GADS_SIGNUP_SEND_TO
const TRIAL_SEND_TO = process.env.NEXT_PUBLIC_GADS_TRIAL_SEND_TO
// Google Ads "signup completed" conversion action — id + label supplied by
// the ads manager. Public client-side id, safe to hardcode; env can override.
const SIGNUP_COMPLETED_SEND_TO =
  process.env.NEXT_PUBLIC_GADS_SIGNUP_COMPLETED_SEND_TO || 'AW-18356615565/EhuOCJq_qtgcEI3zjrFE'

function gtagSafe(...args) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag(...args)
  }
}

// Plain dataLayer push — gtag('event', ...) entries are NOT visible to GTM
// custom-event triggers (they're arguments-style), so we also push the
// {event: ...} shape the GTM container can trigger tags on.
function dataLayerPush(payload) {
  if (typeof window !== 'undefined' && Array.isArray(window.dataLayer)) {
    window.dataLayer.push(payload)
  }
}

function fireFunnelEvent(name, params = {}) {
  gtagSafe('event', name, params)
  dataLayerPush({ event: name, ...params })
}

// ── Funnel step 1: landed on the signup page ────────────────────────────────
export function trackBeginSignup() {
  fireFunnelEvent('begin_signup')
}

// ── Funnel step 2: account created, arrived at onboarding ───────────────────
export function trackStartOnboarding() {
  fireFunnelEvent('start_onboarding')
}

// ── Funnel step 3: onboarding finished (trial subscription created) ─────────
// MUST fire exactly once per newly created account — never on login, refresh,
// or revisits. Two guards:
//   - callers only invoke this when the onboarding-complete API confirms a
//     FIRST-time completion (its idempotent response flags retries with
//     alreadyCompleted, which callers must check) — the server is the source
//     of truth across devices/sessions
//   - a per-user localStorage latch belts-and-braces the same browser
export function trackSignupCompleted(plan, userId) {
  try {
    const latch = `airo_signup_completed_${userId || 'unknown'}`
    if (typeof window !== 'undefined' && localStorage.getItem(latch)) return
    if (typeof window !== 'undefined') localStorage.setItem(latch, '1')
  } catch {}
  fireFunnelEvent('signup_completed', { plan })
  // Google Ads conversion — same once-per-account rule as the event above.
  gtagSafe('event', 'conversion', {
    send_to: SIGNUP_COMPLETED_SEND_TO,
    value: 1.0,
    currency: 'USD',
  })
}

// Account created (email form or Google OAuth). Not fired for invited team
// members — those aren't ad-driven signups.
export function trackSignUpConversion(method) {
  gtagSafe('event', 'sign_up', { method })
  dataLayerPush({ event: 'sign_up', method })
  if (SIGNUP_SEND_TO) gtagSafe('event', 'conversion', { send_to: SIGNUP_SEND_TO })
}

// Onboarding completed: card added + 7-day trial subscription created.
export function trackTrialStartConversion(plan) {
  gtagSafe('event', 'start_trial', { plan })
  dataLayerPush({ event: 'start_trial', plan })
  if (TRIAL_SEND_TO) gtagSafe('event', 'conversion', { send_to: TRIAL_SEND_TO, value: 0.0, currency: 'USD' })
}
