// Kicks off the Google Sheets OAuth flow — mirrors the Monday start route.
//   GET /api/integrations/google-sheets/oauth/start
// → 302 to https://accounts.google.com/o/oauth2/v2/auth
//
// Reuses the app's existing Google OAuth client (GOOGLE_CLIENT_ID/SECRET, the
// same one used for Google sign-in). The callback URL below must be added to
// that client's authorized redirect URIs in the Google Cloud console.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getUserFromRequest } from '@/lib/session-helper'
import { sheetsRedirectUri, SHEETS_SCOPES } from '@/lib/google-sheets'

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.userId || !user?.workspaceId) {
    return NextResponse.redirect(new URL('/login?next=/settings', request.url))
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'Google integration is not configured. Missing GOOGLE_CLIENT_ID env var.' },
      { status: 500 }
    )
  }

  const state = crypto.randomBytes(24).toString('hex')

  const authorizeUrl = new URL(GOOGLE_AUTHORIZE_URL)
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', sheetsRedirectUri(request))
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', SHEETS_SCOPES)
  authorizeUrl.searchParams.set('state', state)
  // offline + consent → Google issues a refresh_token, which we need because
  // access tokens die after an hour and campaigns/automations run for weeks.
  authorizeUrl.searchParams.set('access_type', 'offline')
  authorizeUrl.searchParams.set('prompt', 'consent')

  const response = NextResponse.redirect(authorizeUrl.toString())
  response.cookies.set({
    name: 'sheets_oauth_state',
    value: JSON.stringify({ state, userId: user.userId, workspaceId: user.workspaceId }),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return response
}
