'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    // Always redirect to inbox for authenticated users
    // For non-authenticated users, they should access the marketing site at airophone.airosofts.com
    if (isAuthenticated()) {
      router.replace('/inbox')
    } else {
      // Redirect to login page if not authenticated
      router.replace('/login')
    }
  }, [router])

  // Show loading state while redirecting
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  )
}
