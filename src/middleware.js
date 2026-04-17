import { NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/jwt'

// Routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/signup', '/auth/callback']
const PUBLIC_API_ROUTES = [
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/google',
  '/api/webhooks',   // Telnyx webhooks — no session, verified by signature
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
