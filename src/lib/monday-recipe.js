// Shared helpers for Monday Integration Recipe endpoints (custom actions /
// custom triggers / custom field types).
//
// Auth model
// ----------
// Every request from monday.com to a recipe endpoint carries an `Authorization`
// header containing a JWT signed with the app's *Signing Secret* (HS256). It's
// the same secret we already use to verify board webhooks — MONDAY_SIGNING_SECRET.
// The JWT body decodes to something like:
//   {
//     "accountId": 12345678,           // monday workspace/account id
//     "userId":    87654321,           // the monday user who installed/ran it
//     "shortLivedToken": "eyJ…",       // optional, can be used as a token
//     "backToUrl":       "https://…",  // optional
//     "iat": ..., "exp": ...
//   }
//
// We treat a missing/invalid JWT as 401 — except in the local-dev case where
// MONDAY_SIGNING_SECRET isn't set; then we let it through to make iteration in
// the Monday Developer Center's "Test in monday" tool tolerable.
//
// Workspace resolution
// --------------------
// monday's `accountId` is the *monday account* — we map it back to an
// AiroPhone workspace via `workspace_integrations.credentials.account_id`,
// which the OAuth callback writes when a user connects monday.

import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { supabaseAdmin } from '@/lib/supabase-server'

// Decode + verify the Monday-signed JWT on the request. Returns the decoded
// payload on success; throws RecipeAuthError on failure.
export class RecipeAuthError extends Error {
  constructor(message, status = 401) {
    super(message)
    this.name = 'RecipeAuthError'
    this.status = status
  }
}

export async function verifyMondayRecipeRequest(request) {
  const secret = process.env.MONDAY_SIGNING_SECRET
  const auth = request.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()

  if (!secret) {
    // Local dev / test: log loudly but don't block — otherwise the Monday
    // Developer Center "test action" button is unusable.
    console.warn('[monday-recipe] MONDAY_SIGNING_SECRET unset — skipping JWT verify (dev only)')
    return { accountId: null, userId: null, _unsigned: true }
  }
  if (!token) {
    throw new RecipeAuthError('Missing Authorization header')
  }
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    return payload
  } catch (err) {
    console.warn('[monday-recipe] JWT verify failed:', err.message)
    throw new RecipeAuthError('Invalid signature')
  }
}

// Resolve a monday accountId → AiroPhone workspace_id. The OAuth callback
// stores it on the `account_id` column of workspace_integrations. If no row
// matches, return null and let the caller 404 — there's nothing to do without
// a connected workspace.
export async function workspaceForMondayAccount(accountId) {
  if (!accountId) return null
  const { data, error } = await supabaseAdmin
    .from('workspace_integrations')
    .select('workspace_id')
    .eq('provider', 'monday')
    .eq('account_id', String(accountId))
    .maybeSingle()
  if (error) {
    console.error('[monday-recipe] workspaceForMondayAccount lookup error:', error)
    return null
  }
  return data?.workspace_id || null
}

// Wraps a recipe handler with auth + standard error handling. Use like:
//
//   export const POST = withRecipeAuth(async (request, { payload, body }) => {
//     ...
//     return NextResponse.json({ ... })
//   })
//
// `payload` is the decoded JWT; `body` is the already-parsed JSON request body.
export function withRecipeAuth(handler) {
  return async function (request, ctx) {
    let payload
    try {
      payload = await verifyMondayRecipeRequest(request)
    } catch (err) {
      if (err instanceof RecipeAuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
    let body = {}
    try {
      body = await request.json()
    } catch {
      // Many recipe endpoints (e.g. unsubscribe) are fine with an empty body.
    }
    try {
      return await handler(request, { ...ctx, payload, body })
    } catch (err) {
      console.error('[monday-recipe] handler error:', err)
      return NextResponse.json(
        { error: err.message || 'Internal error' },
        { status: 500 },
      )
    }
  }
}

// Helpers for the action payload shape Monday actually sends.
//   { payload: { inputFields, inboundFieldValues, recipeId, integrationId, ... } }
export function extractInputFields(body) {
  return body?.payload?.inputFields || {}
}

// Parse the optional "wait N minutes" recipe field into an integer count of
// minutes. Monday sends a custom List field value wrapped as { value, title }
// (or sometimes a raw string / stringified object). Returns 0 when unset or
// unparseable, and clamps to a sane ceiling so a typo can't park a send for
// days.
export function parseDelayMinutes(inputFields) {
  const raw = inputFields?.delayMinutes
  let v = raw
  if (v && typeof v === 'object') v = v.value
  else if (typeof v === 'string' && v.trim().startsWith('{')) {
    try { v = JSON.parse(v).value } catch {}
  }
  const n = parseInt(v, 10)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, 720)   // cap at 12h
}

export function extractIds(body) {
  const p = body?.payload || {}
  return {
    recipeId: p.recipeId ? String(p.recipeId) : null,
    integrationId: p.integrationId ? String(p.integrationId) : null,
    webhookUrl: p.webhookUrl || null,
    subscriptionId: p.subscriptionId ? String(p.subscriptionId) : null,
  }
}
