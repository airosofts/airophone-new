'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentUser, isAuthenticated } from '@/lib/auth'
import Sidebar from '@/components/layout/Sidebar'
import ProductTour from '@/components/inbox/ProductTour'
import { CallProvider } from '@/contexts/CallContext'

const BLOCKED_STATUSES = ['canceled', 'past_due']

function SubscriptionBlockedBanner({ planStatus, numbersQuarantined, trialExpired, trialExpiredDaysAgo, onGoToBilling }) {
  const isCanceled = planStatus === 'canceled'
  const isQuarantined = numbersQuarantined
  const daysUntilQuarantine = Math.max(0, 7 - (trialExpiredDaysAgo || 0))

  let icon, iconColor, iconBg, title, message, buttonLabel

  if (isCanceled) {
    iconColor = '#D63B1F'; iconBg = 'rgba(214,59,31,0.08)'
    title = 'Subscription Ended'
    message = 'Your subscription has been canceled. Reactivate to continue using AiroPhone — your data is safe and ready.'
    buttonLabel = 'Reactivate Subscription'
    icon = (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D63B1F" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    )
  } else if (isQuarantined) {
    iconColor = '#b45309'; iconBg = 'rgba(180,83,9,0.08)'
    title = 'Phone Number Quarantined'
    message = trialExpired
      ? `Your free trial ended ${trialExpiredDaysAgo} days ago without an active subscription. Your phone number has been quarantined and will be permanently released in 30 days. Activate now to recover it.`
      : 'Your payment has been failing for 7+ days. Your phone number has been quarantined and will be permanently released in 30 days. Update your payment method now to restore access.'
    buttonLabel = trialExpired ? 'Activate Subscription' : 'Update Payment Method'
    icon = (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    )
  } else if (trialExpired) {
    iconColor = '#D63B1F'; iconBg = 'rgba(214,59,31,0.08)'
    title = 'Free Trial Ended'
    message = `Your free trial ended ${trialExpiredDaysAgo} day${trialExpiredDaysAgo !== 1 ? 's' : ''} ago. Activate your subscription within ${daysUntilQuarantine} day${daysUntilQuarantine !== 1 ? 's' : ''} to keep your phone number — after that it will be quarantined.`
    buttonLabel = 'Activate Subscription'
    icon = (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D63B1F" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    )
  } else {
    iconColor = '#D63B1F'; iconBg = 'rgba(214,59,31,0.08)'
    title = 'Payment Failed'
    message = 'We could not process your payment. Update your payment method within 7 days — after that, your phone number will be quarantined and eventually released.'
    buttonLabel = 'Update Payment Method'
    icon = (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D63B1F" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    )
  }

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
          background: iconBg, border: `1px solid ${iconColor}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          {icon}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#131210', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
          {title}
        </h2>
        <p style={{ fontSize: 14, color: '#5C5A55', lineHeight: 1.6, margin: '0 0 28px' }}>
          {message}
        </p>
        <button
          onClick={onGoToBilling}
          style={{
            width: '100%', height: 44, borderRadius: 10,
            background: iconColor, color: '#FFFFFF',
            border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
          }}
        >
          {buttonLabel}
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
  const [numbersQuarantined, setNumbersQuarantined] = useState(false)
  const [trialExpired, setTrialExpired] = useState(false)
  const [trialExpiredDaysAgo, setTrialExpiredDaysAgo] = useState(0)
  const [showTour, setShowTour] = useState(false)
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

      // Verify the user is still an active member of this workspace
      try {
        const memberRes = await fetch('/api/workspace/members', {
          headers: {
            'x-user-id': currentUser.userId,
            'x-workspace-id': currentUser.workspaceId,
          },
        })
        if (memberRes.ok) {
          const memberData = await memberRes.json()
          const stillMember = memberData.members?.some(m => m.userId === currentUser.userId)
          if (memberData.success && !stillMember) {
            // User has been removed from this workspace — clear session and redirect
            localStorage.removeItem('user_session')
            router.push('/login')
            return
          }
        }
      } catch (e) {
        // Non-critical — allow through if check fails
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
          if (subData.numbersQuarantined) setNumbersQuarantined(true)
          if (subData.trialExpired) {
            setTrialExpired(true)
            setTrialExpiredDaysAgo(subData.trialExpiredDaysAgo || 0)
          }
        }
      } catch (e) {
        console.warn('Subscription check failed:', e)
      }

      setUser(currentUser)

      // Check if user has seen the inbox product tour.
      // Use localStorage as a fast cache so hard reloads don't re-show the tour
      // for users who already dismissed it. Fall back to DB for first-time checks.
      const tourCacheKey = `airo_tour_seen_${currentUser.userId}`
      if (localStorage.getItem(tourCacheKey) === '1') {
        // Already confirmed seen — skip API call
      } else {
        try {
          const tourRes = await fetch('/api/onboarding/tour-seen', {
            headers: {
              'x-user-id': currentUser.userId,
              'x-workspace-id': currentUser.workspaceId,
            },
          })
          if (tourRes.ok) {
            const { seen } = await tourRes.json()
            if (seen) {
              // Cache it so we never have to ask again
              localStorage.setItem(tourCacheKey, '1')
            } else {
              setShowTour(true)
            }
          }
        } catch { /* non-critical */ }
      }

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

  const isBlocked = pathname !== '/billing' && (
    (planStatus && BLOCKED_STATUSES.includes(planStatus)) || trialExpired
  )

  const handleTourDone = async () => {
    setShowTour(false)
    try {
      const s = JSON.parse(localStorage.getItem('user_session') || '{}')
      const uid = s.userId || s.id || ''
      if (uid) localStorage.setItem(`airo_tour_seen_${uid}`, '1')
      await fetch('/api/onboarding/tour-seen', {
        method: 'PATCH',
        headers: {
          'x-user-id': uid,
          'x-workspace-id': s.workspaceId || '',
        },
      })
    } catch { /* non-critical */ }
  }

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: '#F7F6F3',
    }}>
      {/* Subscription blocked overlay — only allow billing page through */}
      {isBlocked && (
        <SubscriptionBlockedBanner
          planStatus={planStatus}
          numbersQuarantined={numbersQuarantined}
          trialExpired={trialExpired}
          trialExpiredDaysAgo={trialExpiredDaysAgo}
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

        <CallProvider>
          {children}
        </CallProvider>
      </main>

      {showTour && <ProductTour onDone={handleTourDone} />}
    </div>
  )
}
