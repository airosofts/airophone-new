// Google redirects here after authorization — mirrors the Monday callback.
//   1. Verify state matches the cookie set in /start (CSRF protection)
//   2. Exchange the code for access_token + refresh_token
//   3. Fetch the Google account email to label the connection
//   4. Upsert workspace_integrations(provider='google_sheets', credentials=...)
//   5. Redirect back to /settings with a success/error flag

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { sheetsRedirectUri } from '@/lib/google-sheets'
import { appOrigin } from '@/lib/monday'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

function settingsRedirect(request, params) {
  const url = new URL('/settings', appOrigin(request))
  url.searchParams.set('section', 'integrations')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateFromQuery = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) {
    return settingsRedirect(request, { sheets_error: oauthError })
  }
  if (!code || !stateFromQuery) {
    return settingsRedirect(request, { sheets_error: 'missing_code_or_state' })
  }

  const cookieRaw = request.cookies.get('sheets_oauth_state')?.value
  if (!cookieRaw) {
    return settingsRedirect(request, { sheets_error: 'state_cookie_missing' })
  }

  let parsed
  try { parsed = JSON.parse(cookieRaw) }
  catch { return settingsRedirect(request, { sheets_error: 'state_cookie_corrupt' }) }

  if (parsed.state !== stateFromQuery) {
    return settingsRedirect(request, { sheets_error: 'state_mismatch' })
  }

  const { userId, workspaceId } = parsed
  if (!userId || !workspaceId) {
    return settingsRedirect(request, { sheets_error: 'state_missing_context' })
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return settingsRedirect(request, { sheets_error: 'server_misconfigured' })
  }

  // 1) Exchange code → tokens
  let tokenJson
  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: sheetsRedirectUri(request),
        grant_type: 'authorization_code',
      }),
    })
    tokenJson = await tokenRes.json()
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error('[sheets/callback] token exchange failed:', tokenJson)
      return settingsRedirect(request, { sheets_error: 'token_exchange_failed' })
    }
    // No refresh_token means Google reused a prior grant (prompt=consent should
    // prevent that, but be loud if it happens — the connection would die in 1h).
    if (!tokenJson.refresh_token) {
      console.warn('[sheets/callback] no refresh_token in response — connection will expire in ~1h')
    }
  } catch (err) {
    console.error('[sheets/callback] token fetch error:', err)
    return settingsRedirect(request, { sheets_error: 'token_network_error' })
  }

  // 2) Account email for the settings label — non-fatal if it fails.
  let accountEmail = null
  try {
    const meRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    })
    const me = await meRes.json()
    if (meRes.ok && me?.email) accountEmail = me.email
  } catch (err) {
    console.warn('[sheets/callback] userinfo lookup failed:', err.message)
  }

  // 3) Upsert (one connection per workspace per provider). Keep an existing
  // refresh_token if Google didn't return a fresh one on reconnect.
  let refreshToken = tokenJson.refresh_token || null
  if (!refreshToken) {
    const { data: existing } = await supabaseAdmin
      .from('workspace_integrations')
      .select('credentials')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'google_sheets')
      .maybeSingle()
    refreshToken = existing?.credentials?.refresh_token || null
  }

  const now = new Date().toISOString()
  const { error: dbErr } = await supabaseAdmin
    .from('workspace_integrations')
    .upsert(
      {
        workspace_id: workspaceId,
        provider: 'google_sheets',
        credentials: {
          access_token: tokenJson.access_token,
          refresh_token: refreshToken,
          expires_at: Date.now() + (tokenJson.expires_in || 3600) * 1000,
          scope: tokenJson.scope || null,
        },
        account_id: accountEmail,
        account_name: accountEmail,
        account_slug: null,
        connected_by: userId,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: 'workspace_id,provider' }
    )

  if (dbErr) {
    console.error('[sheets/callback] upsert failed:', dbErr)
    return settingsRedirect(request, { sheets_error: 'db_write_failed' })
  }

  const response = settingsRedirect(request, { sheets_connected: '1' })
  response.cookies.set({ name: 'sheets_oauth_state', value: '', path: '/', maxAge: 0 })
  return response
}
