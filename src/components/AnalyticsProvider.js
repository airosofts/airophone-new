'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { initAnalytics, identifyUser, trackPageview } from '@/lib/analytics'

export default function AnalyticsProvider({ children }) {
  const pathname = usePathname()

  useEffect(() => {
    initAnalytics()
    // If a session already exists when the app boots, identify immediately
    try {
      const session = JSON.parse(localStorage.getItem('user_session') || 'null')
      if (session?.userId) identifyUser(session)
    } catch { /* no-op */ }
  }, [])

  useEffect(() => {
    trackPageview()
  }, [pathname])

  return children
}
