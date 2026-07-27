// Google conversion events for the signup funnel (fired client-side).
//
// The base gtag.js tag loads globally in src/app/layout.js. Two layers here:
//   1. GA4 events ('sign_up', 'start_trial') — always fired. The ads manager
//      can import these into Google Ads as conversions with no further code.
//   2. Direct Google Ads website conversions — fired ONLY when the matching
//      send_to id is configured ("AW-XXXXXXXXX/AbCdEfGh", from the Ads
//      conversion action's tag setup). Set via env:
//        NEXT_PUBLIC_GADS_SIGNUP_SEND_TO  — account-created conversion
//        NEXT_PUBLIC_GADS_TRIAL_SEND_TO   — trial-subscription-started conversion
//      Also set NEXT_PUBLIC_GOOGLE_ADS_ID ("AW-XXXXXXXXX") so layout.js
//      configures the Ads tag itself.
const SIGNUP_SEND_TO = process.env.NEXT_PUBLIC_GADS_SIGNUP_SEND_TO
const TRIAL_SEND_TO = process.env.NEXT_PUBLIC_GADS_TRIAL_SEND_TO

function gtagSafe(...args) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag(...args)
  }
}

// Account created (email form or Google OAuth). Not fired for invited team
// members — those aren't ad-driven signups.
export function trackSignUpConversion(method) {
  gtagSafe('event', 'sign_up', { method })
  if (SIGNUP_SEND_TO) gtagSafe('event', 'conversion', { send_to: SIGNUP_SEND_TO })
}

// Onboarding completed: card added + 7-day trial subscription created.
export function trackTrialStartConversion(plan) {
  gtagSafe('event', 'start_trial', { plan })
  if (TRIAL_SEND_TO) gtagSafe('event', 'conversion', { send_to: TRIAL_SEND_TO, value: 0.0, currency: 'USD' })
}
