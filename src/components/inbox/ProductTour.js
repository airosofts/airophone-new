'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'

const STEPS = [
  {
    page: '/inbox',
    target: null,
    title: 'Welcome to AiroPhone! 👋',
    description: "You're all set. We'll take you on a quick tour of the app — click Next to start or Skip to dismiss.",
    position: 'center',
  },
  {
    page: '/inbox',
    target: '[data-tour="left-panel"]',
    title: 'Your Inbox',
    description: 'All SMS conversations live here. Filter by Unread, Done, or Pinned. Switch to the Calls tab to see call logs. Use the phone and chat icons to start new calls or conversations.',
    position: 'right',
  },
  {
    page: '/inbox',
    target: '[data-tour="chat-window"]',
    title: 'Chat Window',
    description: 'Click any conversation to open it here. Read messages, send replies, and make calls. The right side panel shows contact info, notes, and AI scenario assignment.',
    position: 'center',
  },
  {
    page: '/contacts',
    target: null,
    title: 'Contacts',
    description: 'View and manage all your contacts. See full conversation history, add notes, tags, and custom fields for each person.',
    position: 'center',
  },
  {
    page: '/campaigns',
    target: null,
    title: 'Campaigns',
    description: 'Send bulk SMS campaigns to your contact lists. Schedule messages, track delivery rates, and manage your outreach history.',
    position: 'center',
  },
  {
    page: '/scenarios',
    target: null,
    title: 'AI Scenarios',
    description: 'Build AI-powered automation flows that respond to incoming messages automatically. Train your AI with custom instructions and assign scenarios to contacts.',
    position: 'center',
  },
  {
    page: '/analytics',
    target: null,
    title: 'Analytics',
    description: 'Track message volume, response rates, call metrics, and campaign performance across your workspace.',
    position: 'center',
  },
  {
    page: '/billing',
    target: null,
    title: 'Billing & Credits',
    description: "Manage your subscription, view credit usage, and top up your balance. Credits are used for SMS and AI replies — calls are unlimited.",
    position: 'center',
  },
]

export default function ProductTour({ onDone }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [navigating, setNavigating] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  const updateRect = useCallback(() => {
    const target = STEPS[step]?.target
    if (!target) { setRect(null); return }
    const el = document.querySelector(target)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step])

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 400)
    return () => clearTimeout(t)
  }, [])

  // Re-query target element whenever step changes or navigation completes
  useEffect(() => {
    if (!mounted) return
    setNavigating(false)
    const t = setTimeout(updateRect, 120)
    return () => clearTimeout(t)
  }, [mounted, step, pathname, updateRect])

  useEffect(() => {
    if (!mounted) return
    window.addEventListener('resize', updateRect)
    return () => window.removeEventListener('resize', updateRect)
  }, [mounted, updateRect])

  const dismiss = useCallback(() => onDone?.(), [onDone])

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      const nextStep = step + 1
      const nextPage = STEPS[nextStep]?.page
      if (nextPage && nextPage !== pathname) {
        setNavigating(true)
        router.push(nextPage)
      }
      setStep(nextStep)
    } else {
      dismiss()
    }
  }, [step, pathname, router, dismiss])

  const back = useCallback(() => {
    if (step > 0) {
      const prevStep = step - 1
      const prevPage = STEPS[prevStep]?.page
      if (prevPage && prevPage !== pathname) {
        setNavigating(true)
        router.push(prevPage)
      }
      setStep(prevStep)
    }
  }, [step, pathname, router])

  if (!mounted) return null

  const current = STEPS[step]
  const PAD = 8
  const TIP_W = 300
  const isLast = step === STEPS.length - 1
  const showSpotlight = rect && !navigating

  // Tooltip position
  let tooltipStyle = {}
  if (!showSpotlight || current.position === 'center') {
    tooltipStyle = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    }
  } else if (current.position === 'right') {
    tooltipStyle = {
      position: 'fixed',
      top: Math.max(16, Math.min(window.innerHeight - 260, rect.top + rect.height / 2 - 130)),
      left: Math.min(window.innerWidth - TIP_W - 16, rect.right + PAD + 16),
    }
  } else if (current.position === 'left') {
    tooltipStyle = {
      position: 'fixed',
      top: Math.max(16, Math.min(window.innerHeight - 260, rect.top + rect.height / 2 - 130)),
      left: Math.max(16, rect.left - PAD - TIP_W - 16),
    }
  }

  return (
    <>
      {/* Click-outside to dismiss */}
      <div onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 9996, cursor: 'default' }} />

      {/* Full dim — used when no spotlight */}
      {!showSpotlight && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9997,
          background: 'rgba(0,0,0,0.5)', pointerEvents: 'none',
        }} />
      )}

      {/* Animated spotlight box */}
      <div style={{
        position: 'fixed',
        top: showSpotlight ? rect.top - PAD : '50%',
        left: showSpotlight ? rect.left - PAD : '50%',
        width: showSpotlight ? rect.width + PAD * 2 : 0,
        height: showSpotlight ? rect.height + PAD * 2 : 0,
        borderRadius: 12,
        boxShadow: showSpotlight ? '0 0 0 9999px rgba(0,0,0,0.5)' : 'none',
        border: showSpotlight ? '2px solid rgba(214,59,31,0.7)' : 'none',
        zIndex: 9997,
        pointerEvents: 'none',
        opacity: showSpotlight ? 1 : 0,
        transition: 'top 0.32s cubic-bezier(0.4,0,0.2,1), left 0.32s cubic-bezier(0.4,0,0.2,1), width 0.32s, height 0.32s, opacity 0.2s',
      }} />

      {/* Tooltip card */}
      <div
        key={step}
        style={{
          ...tooltipStyle,
          zIndex: 9999,
          width: TIP_W,
          background: '#FFFFFF',
          border: '1px solid #E3E1DB',
          borderRadius: 14,
          boxShadow: '0 20px 56px rgba(19,18,16,0.2)',
          overflow: 'hidden',
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          animation: 'tourFadeIn 0.22s ease forwards',
        }}
      >
        {/* Step progress bar */}
        <div style={{ display: 'flex', gap: 3, padding: '14px 16px 0' }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i <= step ? '#D63B1F' : '#E3E1DB',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px 16px' }}>
          {/* Page badge when navigating to a new section */}
          {step > 0 && STEPS[step].page !== STEPS[step - 1].page && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(214,59,31,0.07)', borderRadius: 5,
              padding: '2px 8px', marginBottom: 8,
            }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#D63B1F" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#D63B1F', letterSpacing: '0.02em' }}>
                Navigated to {STEPS[step].page.replace('/', '').replace('-', ' ') || 'page'}
              </span>
            </div>
          )}

          <p style={{ fontSize: 13.5, fontWeight: 600, color: '#131210', marginBottom: 7, letterSpacing: '-0.02em' }}>
            {current.title}
          </p>
          <p style={{ fontSize: 12.5, color: '#5C5A55', lineHeight: 1.65, fontWeight: 300, marginBottom: 16 }}>
            {current.description}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={dismiss} style={{
              fontSize: 12, color: '#9B9890', background: 'none',
              border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
            }}>
              Skip tour
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#C4C2BC', marginRight: 4 }}>
                {step + 1} / {STEPS.length}
              </span>
              {step > 0 && (
                <button onClick={back} style={{
                  padding: '6px 13px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                  background: 'transparent', border: '1px solid #E3E1DB', color: '#5C5A55',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Back
                </button>
              )}
              <button onClick={next} style={{
                padding: '6px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                background: '#D63B1F', border: 'none', color: '#FFFFFF',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {isLast ? 'Done ✓' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes tourFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  )
}
