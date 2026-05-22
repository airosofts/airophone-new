// Monday redirects here after authorization with ?code=...&state=...
// We:
//   1. Verify state matches the cookie we set in /start (CSRF protection)
//   2. Exchange the code for an access_token at https://auth.monday.com/oauth2/token
//   3. Call Monday's GraphQL `me { account { ... } }` to label the connection
//   4. Upsert workspace_integrations(provider='monday', credentials=...)
//   5. Redirect the user back to /settings with a success/error flag

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { mondayRedirectUri } from '@/lib/monday'

const MONDAY_TOKEN_URL = 'https://auth.monday.com/oauth2/token'
const MONDAY_GRAPHQL_URL = 'https://api.monday.com/v2'

function settingsRedirect(request, params) {
  const url = new URL('/settings', request.url)
  url.searchParams.set('section', 'integrations')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateFromQuery = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  // User clicked "Deny" on Monday's authorize page (or scope error).
  if (oauthError) {
    return settingsRedirect(request, { monday_error: oauthError })
  }
  if (!code || !stateFromQuery) {
    return settingsRedirect(request, { monday_error: 'missing_code_or_state' })
  }

  // Verify state from cookie (CSRF + retrieve the workspace context that the
  // start route stamped in).
  const cookieRaw = request.cookies.get('monday_oauth_state')?.value
  if (!cookieRaw) {
    return settingsRedirect(request, { monday_error: 'state_cookie_missing' })
  }

  let parsed
  try { parsed = JSON.parse(cookieRaw) }
  catch { return settingsRedirect(request, { monday_error: 'state_cookie_corrupt' }) }

  if (parsed.state !== stateFromQuery) {
    return settingsRedirect(request, { monday_error: 'state_mismatch' })
  }

  const { userId, workspaceId } = parsed
  if (!userId || !workspaceId) {
    return settingsRedirect(request, { monday_error: 'state_missing_context' })
  }

  const clientId = process.env.MONDAY_CLIENT_ID
  const clientSecret = process.env.MONDAY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return settingsRedirect(request, { monday_error: 'server_misconfigured' })
  }

  // 1) Exchange code → access_token
  let tokenJson
  try {
    const tokenRes = await fetch(MONDAY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: mondayRedirectUri(request),
      }),
    })
    tokenJson = await tokenRes.json()
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error('[monday/callback] token exchange failed:', tokenJson)
      return settingsRedirect(request, { monday_error: 'token_exchange_failed' })
    }
  } catch (err) {
    console.error('[monday/callback] token fetch error:', err)
    return settingsRedirect(request, { monday_error: 'token_network_error' })
  }

  // 2) Fetch account info so we can label the connection in the UI
  let account = { id: null, name: null, slug: null }
  try {
    const meRes = await fetch(MONDAY_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenJson.access_token,
      },
      body: JSON.stringify({
        query: '{ me { id name email account { id name slug } } }',
      }),
    })
    const meJson = await meRes.json()
    if (meJson?.data?.me?.account) {
      account = {
        id: String(meJson.data.me.account.id ?? ''),
        name: meJson.data.me.account.name ?? null,
        slug: meJson.data.me.account.slug ?? null,
      }
    }
  } catch (err) {
    // Non-fatal — connection still works, just without a nice label.
    console.warn('[monday/callback] me lookup failed:', err.message)
  }

  // 3) Upsert (one connection per workspace per provider)
  const now = new Date().toISOString()
  const { error: dbErr } = await supabaseAdmin
    .from('workspace_integrations')
    .upsert(
      {
        workspace_id: workspaceId,
        provider: 'monday',
        credentials: {
          access_token: tokenJson.access_token,
          token_type: tokenJson.token_type || 'bearer',
          scope: tokenJson.scope || null,
        },
        account_id: account.id,
        account_name: account.name,
        account_slug: account.slug,
        connected_by: userId,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: 'workspace_id,provider' }
    )

  if (dbErr) {
    console.error('[monday/callback] upsert failed:', dbErr)
    return settingsRedirect(request, { monday_error: 'db_write_failed' })
  }

  const response = settingsRedirect(request, { monday_connected: '1' })
  // Clear the state cookie now that it's consumed.
  response.cookies.set({
    name: 'monday_oauth_state', value: '', path: '/', maxAge: 0,
  })
  return response
}
