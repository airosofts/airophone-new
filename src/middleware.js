import { NextResponse } from 'next/server'

export function middleware(request) {
  const { pathname } = request.nextUrl
  
  // Public routes that don't need authentication
  const publicRoutes = ['/login', '/api/auth/login']
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Protected routes
  const protectedRoutes = ['/', '/dashboard', '/inbox', '/contacts', '/campaigns']
  if (protectedRoutes.some(route => pathname.startsWith(route))) {
    // In a localStorage world, you might need client-side checks
    // This middleware becomes less critical
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}