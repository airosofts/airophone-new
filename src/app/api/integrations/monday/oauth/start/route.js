// Kicks off the Monday OAuth flow.
//   GET /api/integrations/monday/oauth/start
// → 302 to https://auth.monday.com/oauth2/authorize
//
// We stash {state, userId, workspaceId} in a short-lived signed cookie so the
// callback can (a) verify the state token wasn't tampered with and (b) attribute
// the connection to the right workspace without needing a separate DB lookup.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getUserFromRequest } from '@/lib/session-helper'
import { mondayRedirectUri } from '@/lib/monday'

const MONDAY_AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize'
// boards:read         — listing boards, columns, items.
// boards:write        — two-way sync writes back column values (change_column_value).
// me/account/workspaces:read — account info.
// webhooks:write      — board automations register webhooks via the API.
const SCOPES = ['boards:read', 'boards:write', 'me:read', 'account:read', 'workspaces:read', 'webhooks:write'].join(' ')

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.userId || !user?.workspaceId) {
    return NextResponse.redirect(new URL('/login?next=/settings', request.url))
  }

  const clientId = process.env.MONDAY_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'Monday integration is not configured. Missing MONDAY_CLIENT_ID env var.' },
      { status: 500 }
    )
  }

  const state = crypto.randomBytes(24).toString('hex')
  const redirectUri = mondayRedirectUri(request)

  const authorizeUrl = new URL(MONDAY_AUTHORIZE_URL)
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('scope', SCOPES)
  // Force the consent screen every time — Monday otherwise silently re-issues
  // the previously-granted scopes when the user is already authorized, which
  // means newly-added scopes (e.g. webhooks:write) never get granted.
  authorizeUrl.searchParams.set('prompt', 'consent')

  const response = NextResponse.redirect(authorizeUrl.toString())

  // 10-minute TTL is plenty — Monday's authorize page rarely takes that long.
  response.cookies.set({
    name: 'monday_oauth_state',
    value: JSON.stringify({
      state,
      userId: user.userId,
      workspaceId: user.workspaceId,
    }),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })

  return response
}
