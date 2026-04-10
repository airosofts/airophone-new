'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser, isAuthenticated } from '@/lib/auth'
import Sidebar from '@/components/layout/Sidebar'

export default function DashboardLayout({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const checkAuth = async () => {
      const currentUser = getCurrentUser()
      const authenticated = isAuthenticated()

      if (!currentUser || !authenticated) {
        router.push('/login')
        return
      }

      // Check if onboarding is completed (only for users who have an onboarding profile)
      try {
        const checkRes = await fetch('/api/onboarding/status', {
          headers: {
            'x-user-id': currentUser.userId,
            'x-workspace-id': currentUser.workspaceId,
          },
        })
        if (checkRes.ok) {
          const data = await checkRes.json()
          if (data.onboarding_completed === false) {
            router.push('/onboarding')
            return
          }
        }
      } catch (e) {
        // If check fails, allow through (don't block existing users)
        console.warn('Onboarding check failed:', e)
      }

      setUser(currentUser)
      setLoading(false)
    }

    checkAuth()
  }, [router])

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#F7F6F3',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ position: 'relative', width: 48, height: 48, margin: '0 auto 20px' }}>
            <div style={{
              position: 'absolute', inset: 0,
              border: '3px solid rgba(214,59,31,0.15)', borderRadius: '50%',
            }} />
            <div style={{
              position: 'absolute', inset: 0,
              border: '3px solid #D63B1F', borderTop: '3px solid transparent',
              borderRadius: '50%', animation: 'spin 1s linear infinite',
            }} />
          </div>
          <p style={{ fontSize: 13, color: '#5C5A55', fontWeight: 400 }}>
            Loading your workspace...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: '#F7F6F3',
    }}>
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          style={{ background: 'rgba(19,18,16,0.3)', transition: 'opacity 0.3s' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-transform duration-300 ease-in-out fixed lg:relative z-40 h-full`}>
        <Sidebar
          user={user}
          onClose={() => setSidebarOpen(false)}
          onNotificationNavigate={(conversationId, noteId, fromNumber) => {
            const inboxUrl = fromNumber
              ? `/inbox?from=${encodeURIComponent(fromNumber)}`
              : '/inbox'
            router.push(inboxUrl)
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('notification-navigate', {
                detail: { conversationId, noteId }
              }))
            }, 500)
          }}
        />
      </div>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* Mobile Header */}
        <div
          className="flex lg:hidden items-center justify-between"
          style={{
            padding: '0 16px', height: 56,
            background: '#FFFFFF', borderBottom: '1px solid #E3E1DB',
            position: 'sticky', top: 0, zIndex: 20,
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              padding: 8, background: 'none', border: 'none',
              cursor: 'pointer', display: 'flex', color: '#5C5A55',
              borderRadius: 6, transition: 'background 0.15s',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="24" height="24" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="78" height="78" rx="17" stroke="#D63B1F" strokeWidth="2.5"/>
              <path d="M22 58L40 22L58 58" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M29 45H51" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round"/>
              <circle cx="57" cy="21" r="5" fill="#D63B1F"/>
            </svg>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210' }}>
              AiroPhone
            </span>
          </div>
          <div style={{ width: 36 }} /> {/* Spacer for centering */}
        </div>

        {children}
      </main>
    </div>
  )
}
