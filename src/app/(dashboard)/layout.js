'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentUser, isAuthenticated } from '@/lib/auth'
import Sidebar from '@/components/layout/Sidebar'

const BLOCKED_STATUSES = ['canceled', 'past_due']

function SubscriptionBlockedBanner({ planStatus, onGoToBilling }) {
  const isCanceled = planStatus === 'canceled'
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(19,18,16,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      padding: '24px',
    }}>
      <div style={{
        background: '#FFFFFF', borderRadius: 16, padding: '40px 36px',
        maxWidth: 460, width: '100%', textAlign: 'center',
        boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(214,59,31,0.08)', border: '1px solid rgba(214,59,31,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D63B1F" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#131210', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
          {isCanceled ? 'Subscription Ended' : 'Payment Failed'}
        </h2>
        <p style={{ fontSize: 14, color: '#5C5A55', lineHeight: 1.6, margin: '0 0 28px' }}>
          {isCanceled
            ? 'Your subscription has been canceled. Reactivate to continue using AiroPhone — your data is safe and ready.'
            : 'We could not process your payment. Please update your payment method to restore access.'}
        </p>
        <button
          onClick={onGoToBilling}
          style={{
            width: '100%', height: 44, borderRadius: 10,
            background: '#D63B1F', color: '#FFFFFF',
            border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
          }}
        >
          {isCanceled ? 'Reactivate Subscription' : 'Update Payment Method'}
        </button>
      </div>
    </div>
  )
}

export default function DashboardLayout({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [planStatus, setPlanStatus] = useState(null)
  const router = useRouter()
  const pathname = usePathname()

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
          // Members are invited into existing workspaces — never send them to onboarding
          const isMember = currentUser.role === 'member' || currentUser.workspaceRole === 'member'
          if (data.onboarding_completed === false && !isMember) {
            router.push('/onboarding')
            return
          }
        }
      } catch (e) {
        // If check fails, allow through (don't block existing users)
        console.warn('Onboarding check failed:', e)
      }

      // Check subscription status — block access for canceled/past_due
      try {
        const subRes = await fetch('/api/subscription', {
          headers: {
            'x-user-id': currentUser.userId,
            'x-workspace-id': currentUser.workspaceId,
          },
        })
        if (subRes.ok) {
          const subData = await subRes.json()
          const status = subData.subscription?.status
          if (status && BLOCKED_STATUSES.includes(status)) {
            setPlanStatus(status)
          }
        }
      } catch (e) {
        console.warn('Subscription check failed:', e)
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

  const isBlocked = planStatus && BLOCKED_STATUSES.includes(planStatus) && pathname !== '/billing'

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: '#F7F6F3',
    }}>
      {/* Subscription blocked overlay — only allow billing page through */}
      {isBlocked && (
        <SubscriptionBlockedBanner
          planStatus={planStatus}
          onGoToBilling={() => router.push('/billing')}
        />
      )}

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
