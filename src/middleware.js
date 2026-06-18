import { NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/jwt'

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/login',
  '/signup',
  '/auth/callback',
  // Password reset flow — reached by logged-out users who can't sign in.
  // Without this, middleware redirects them to /login?redirect=/forgot-password
  // and the page is unreachable.
  '/forgot-password',
  // App-onboarding page iframed by monday.com after install. Visitors are
  // monday users who haven't yet signed into AiroPhone — must be accessible
  // without a session.
  '/integrations/monday/welcome',
  // Long-form "How to use" docs page linked from the monday marketplace
  // listing. Reachable by anyone evaluating whether to install the app.
  '/integrations/monday/setup',
]
const PUBLIC_API_ROUTES = [
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/google',
  '/api/auth/forgot-password',   // send-otp / verify-otp / reset — all pre-auth
  '/api/webhooks',   // Telnyx + Monday webhooks — no session, verified by signature
  '/api/external',   // External API key endpoints — Bearer-token auth handled in route
  // Monday Integration Recipe endpoints — authenticated by a JWT monday signs
  // with MONDAY_SIGNING_SECRET (verified inside each route via
  // lib/monday-recipe). They have no AiroPhone user session.
  '/api/integrations/monday/recipe',
  // followup-cron endpoint — gated by Bearer CRON_SECRET inside the route,
  // not by user session. Middleware would otherwise 401 it (cron sends the
  // raw CRON_SECRET as Bearer, which isn't a valid JWT).
  '/api/automations/process-pending',
  // RVM queue sweeper — same pattern: Bearer CRON_SECRET, no user session.
  '/api/voicemail-campaigns/process-queue',
  // Scheduled / send-later SMS sweeper — same pattern: Bearer CRON_SECRET.
  '/api/sms/process-scheduled',
  // SMS campaign queue sweeper — same pattern: Bearer CRON_SECRET.
  '/api/campaigns/process-queue',
  // Deferred AI replies (business-hours reply mode) — Bearer CRON_SECRET.
  '/api/scenarios/process-deferred-replies',
]

export async function middleware(request) {
  const { pathname } = request.nextUrl

  // Always allow public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Always allow public API routes
  if (PUBLIC_API_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Check session for everything else
  const session = await getSessionFromRequest(request)

  if (!session) {
    // API routes return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Pages redirect to login
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Inject user context into request headers for API routes
  if (pathname.startsWith('/api/')) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', session.userId)
    requestHeaders.set('x-workspace-id', session.workspaceId)
    if (session.messagingProfileId) {
      requestHeaders.set('x-messaging-profile-id', session.messagingProfileId)
    }
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|xml|txt)$).*)',
  ],
}
