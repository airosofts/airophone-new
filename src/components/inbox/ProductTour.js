'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'

const STEPS = [
  // ── Welcome ───────────────────────────────────────────────────────────
  {
    page: '/inbox',
    target: null,
    title: 'Welcome to AiroPhone! 👋',
    body: "You're all set. Let's walk through the key features so you can hit the ground running. This takes about 2 minutes.",
    tip: null,
  },

  // ── Inbox ─────────────────────────────────────────────────────────────
  {
    page: '/inbox',
    target: '[data-tour="left-panel"]',
    title: 'Your Conversations',
    body: 'Every SMS conversation with your contacts lands here. Use the tabs to filter by Unread, Pinned, or Done. The Calls tab shows your call history.',
    tip: null,
  },
  {
    page: '/inbox',
    target: '[data-tour="inbox-actions"]',
    title: 'Start a Call or Message',
    body: 'These buttons let you initiate a new outbound SMS or call at any time — without waiting for a contact to reach out first.',
    tip: null,
  },
  {
    page: '/inbox',
    target: '[data-tour="chat-window"]',
    title: 'The Chat Window',
    body: 'Click any conversation on the left to open it here. Read the full thread, send a reply, use a saved template, or start a call directly from this panel.',
    tip: null,
  },
  {
    page: '/inbox',
    target: '[data-tour="contact-panel"]',
    title: 'Contact & AI Sidebar',
    body: "On the right you'll see the contact's details, notes, tags, and which AI scenario is active. Switch scenarios or turn AI off from here.",
    tip: null,
  },

  // ── Contacts ─────────────────────────────────────────────────────────
  {
    page: '/contacts',
    target: null,
    title: 'Contacts',
    body: "This is your contact database. Every person you've messaged or called shows up here. Add contacts manually, import a CSV, or organize them into lists.",
    tip: null,
  },
  {
    page: '/contacts',
    target: '[data-tour="contacts-header"]',
    title: 'Add & Import Contacts',
    body: 'Click "Add Contact" to add someone manually, or "Import CSV" to upload a spreadsheet. Create Contact Lists here too — required before sending a campaign.',
    tip: '💡 Import your existing customer list as a CSV to get started fast.',
  },

  // ── Campaigns — page overview ────────────────────────────────────────
  {
    page: '/campaigns',
    target: null,
    title: 'SMS Campaigns',
    body: "Campaigns let you send a bulk SMS to an entire contact list at once — perfect for promotions, reminders, or announcements. Each campaign tracks delivery and responses.",
    tip: null,
  },
  // ── Campaigns — open builder ─────────────────────────────────────────
  {
    page: '/campaigns',
    target: '[data-tour="campaign-modal-header"]',
    openModal: 'campaign',
    title: 'Inside the Campaign Builder',
    body: "We've opened the campaign builder for you. It has two sections: your message on the left and settings on the right. Let's walk through each.",
    tip: null,
  },
  {
    page: '/campaigns',
    target: '[data-tour="campaign-modal-name"]',
    modal: 'campaign',
    title: 'Campaign Name',
    body: 'Give your campaign a clear name like "May Promo" or "Appointment Reminders" so you can find it later.',
    tip: null,
  },
  {
    page: '/campaigns',
    target: '[data-tour="campaign-modal-message"]',
    modal: 'campaign',
    title: 'SMS Message',
    body: "Write the message your contacts will receive. Click a placeholder tag below the box — like {first_name} — to personalize each message automatically.",
    tip: '💡 Always add "Reply STOP to unsubscribe" somewhere in your message to stay compliant.',
  },
  {
    page: '/campaigns',
    target: '[data-tour="campaign-modal-settings"]',
    modal: 'campaign',
    closeModalOnLeave: 'campaign',
    title: 'Contact List & Sending',
    body: "Choose which contact list to send to, which of your phone numbers to send from, and whether to send now or schedule for a specific date and time.",
    tip: null,
  },

  // ── Scenarios — page overview ────────────────────────────────────────
  {
    page: '/scenarios',
    target: null,
    title: 'AI Scenarios',
    body: "Scenarios are AI-powered automation flows that respond to incoming messages on your behalf — 24/7. Write the instructions once and the AI handles every conversation.",
    tip: null,
  },
  // ── Scenarios — open builder ─────────────────────────────────────────
  {
    page: '/scenarios',
    target: '[data-tour="scenario-modal-header"]',
    openModal: 'scenario',
    title: 'Inside the Scenario Builder',
    body: "We've opened the scenario builder. Left side: name and AI instructions. Right side: phone numbers, contact assignments, and advanced options.",
    tip: null,
  },
  {
    page: '/scenarios',
    target: '[data-tour="scenario-modal-name"]',
    modal: 'scenario',
    title: 'Scenario Name',
    body: 'Give it a clear name that describes what this AI does — e.g. "Real Estate Lead Follow-up" or "Support Auto-Reply".',
    tip: null,
  },
  {
    page: '/scenarios',
    target: '[data-tour="scenario-modal-instructions"]',
    modal: 'scenario',
    title: 'AI Instructions',
    body: "This is the most important field. Write detailed instructions for the AI — who it is, what topics it handles, and how to respond. Think of it as writing a script for a very smart assistant.",
    tip: '💡 The more specific your instructions, the better the AI performs.',
  },
  {
    page: '/scenarios',
    target: '[data-tour="scenario-modal-phone"]',
    modal: 'scenario',
    closeModalOnLeave: 'scenario',
    title: 'Phone Numbers & Contacts',
    body: "Assign which of your phone numbers this scenario monitors. You can also pre-assign specific contacts or contact lists so the AI starts working on them immediately.",
    tip: null,
  },

  // ── Analytics ────────────────────────────────────────────────────────
  {
    page: '/analytics',
    target: null,
    title: 'Analytics',
    body: "Get a full picture of your team's activity — messages sent and received, calls made, campaign delivery rates, and credit usage over time.",
    tip: null,
  },

  // ── Billing ───────────────────────────────────────────────────────────
  {
    page: '/billing',
    target: null,
    title: 'Billing & Credits',
    body: "Credits power SMS and AI replies. Your plan includes a monthly credit allowance that resets each billing period. Top up anytime or enable auto-recharge so you never run out mid-campaign.",
    tip: "💡 Calls are unlimited and don't use credits — only SMS and AI responses do.",
  },
]

export default function ProductTour({ onDone }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [navigating, setNavigating] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 300)
    return () => clearTimeout(t)
  }, [])

  const measureTarget = useCallback(() => {
    const target = STEPS[step]?.target
    if (!target) { setRect(null); return }
    const el = document.querySelector(target)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step])

  // Re-measure after navigation / step change settles
  useEffect(() => {
    if (!mounted) return
    setNavigating(false)
    const t1 = setTimeout(measureTarget, 80)
    const t2 = setTimeout(measureTarget, 450)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [mounted, step, pathname, measureTarget])

  useEffect(() => {
    if (!mounted) return
    window.addEventListener('resize', measureTarget)
    return () => window.removeEventListener('resize', measureTarget)
  }, [mounted, measureTarget])

  // Open modal when entering a step that requires it, then re-measure
  useEffect(() => {
    if (!mounted) return
    const current = STEPS[step]
    if (!current?.openModal) return
    const t = setTimeout(() => {
      window.dispatchEvent(new CustomEvent(`tour:open-${current.openModal}-modal`))
      // Extra measurement passes after modal renders
      setTimeout(measureTarget, 200)
      setTimeout(measureTarget, 500)
    }, 300)
    return () => clearTimeout(t)
  }, [step, mounted, measureTarget])

  const dismiss = useCallback(() => {
    // Close any open modal before dismissing
    const current = STEPS[step]
    if (current?.modal || current?.openModal) {
      const modalName = current.modal || current.openModal
      window.dispatchEvent(new CustomEvent(`tour:close-${modalName}-modal`))
    }
    onDone?.()
  }, [onDone, step])

  const goToStep = useCallback((nextStep) => {
    const currentData = STEPS[step]
    const nextData = STEPS[nextStep]

    // Close current modal if we're leaving it
    const currentModal = currentData?.closeModalOnLeave || (currentData?.modal && !nextData?.modal ? currentData.modal : null)
    if (currentModal) {
      window.dispatchEvent(new CustomEvent(`tour:close-${currentModal}-modal`))
    }

    const nextPage = nextData?.page
    if (nextPage && nextPage !== pathname) {
      setNavigating(true)
      router.push(nextPage)
    }
    setStep(nextStep)
  }, [pathname, router, step])

  const next = useCallback(() => {
    if (step < STEPS.length - 1) goToStep(step + 1)
    else dismiss()
  }, [step, goToStep, dismiss])

  const back = useCallback(() => {
    if (step > 0) goToStep(step - 1)
  }, [step, goToStep])

  if (!mounted) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1
  const TIP_W = 400
  const PAD = 10
  const showSpotlight = rect && !navigating

  // ── Tooltip position ────────────────────────────────────────────────
  let tooltipStyle
  if (!showSpotlight) {
    tooltipStyle = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    }
  } else {
    const vh = window.innerHeight
    const elementBottom = rect.bottom + PAD
    const elementTop = rect.top - PAD
    const tooltipHeight = 240
    const BOTTOM_MARGIN = 24
    const TOP_MARGIN = 24

    if (elementBottom + tooltipHeight + BOTTOM_MARGIN < vh) {
      tooltipStyle = {
        position: 'fixed',
        top: elementBottom + 12,
        left: '50%',
        transform: 'translateX(-50%)',
      }
    } else if (elementTop - tooltipHeight - TOP_MARGIN > 0) {
      tooltipStyle = {
        position: 'fixed',
        top: elementTop - tooltipHeight - 12,
        left: '50%',
        transform: 'translateX(-50%)',
      }
    } else {
      tooltipStyle = {
        position: 'fixed',
        bottom: 28,
        left: '50%',
        transform: 'translateX(-50%)',
      }
    }
  }

  const pageName = current.page.replace('/', '').replace('-', ' ') || 'page'
  const prevPage = step > 0 ? STEPS[step - 1].page : null
  const isNewPage = prevPage && current.page !== prevPage

  return (
    <>
      {/* Dim layer — click outside dismisses */}
      <div
        onClick={dismiss}
        style={{ position: 'fixed', inset: 0, zIndex: 9996, cursor: 'default' }}
      />

      {/* Solid dim when no spotlight */}
      {!showSpotlight && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9997,
          background: 'rgba(0,0,0,0.45)', pointerEvents: 'none',
        }} />
      )}

      {/* Spotlight box */}
      <div style={{
        position: 'fixed',
        top: showSpotlight ? rect.top - PAD : '50%',
        left: showSpotlight ? rect.left - PAD : '50%',
        width: showSpotlight ? rect.width + PAD * 2 : 0,
        height: showSpotlight ? rect.height + PAD * 2 : 0,
        borderRadius: 10,
        boxShadow: showSpotlight ? '0 0 0 9999px rgba(0,0,0,0.55)' : 'none',
        border: showSpotlight ? '2px solid rgba(214,59,31,0.8)' : 'none',
        zIndex: 9997,
        pointerEvents: 'none',
        opacity: showSpotlight ? 1 : 0,
        transition: 'top 0.28s cubic-bezier(0.4,0,0.2,1), left 0.28s cubic-bezier(0.4,0,0.2,1), width 0.28s, height 0.28s, opacity 0.18s',
      }} />

      {/* Tooltip card */}
      <div
        key={step}
        style={{
          ...tooltipStyle,
          zIndex: 9999,
          width: TIP_W,
          maxWidth: 'calc(100vw - 32px)',
          background: '#FFFFFF',
          border: '1px solid #E3E1DB',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(19,18,16,0.22)',
          overflow: 'hidden',
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          animation: 'tourFadeIn 0.18s ease forwards',
        }}
      >
        {/* Progress bar */}
        <div style={{ display: 'flex', gap: 3, padding: '14px 18px 0' }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i < step ? '#D63B1F' : i === step ? 'rgba(214,59,31,0.5)' : '#E3E1DB',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: '13px 18px 16px' }}>
          {isNewPage && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(214,59,31,0.07)', border: '1px solid rgba(214,59,31,0.14)',
              borderRadius: 5, padding: '3px 10px', marginBottom: 10,
            }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#D63B1F" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#D63B1F', textTransform: 'capitalize', letterSpacing: '0.02em' }}>
                {pageName}
              </span>
            </div>
          )}

          <p style={{ fontSize: 14, fontWeight: 700, color: '#131210', marginBottom: 6, letterSpacing: '-0.02em', lineHeight: 1.3 }}>
            {current.title}
          </p>
          <p style={{ fontSize: 13, color: '#5C5A55', lineHeight: 1.7, fontWeight: 400, marginBottom: current.tip ? 10 : 16 }}>
            {current.body}
          </p>

          {current.tip && (
            <div style={{
              background: 'rgba(214,59,31,0.05)', border: '1px solid rgba(214,59,31,0.12)',
              borderRadius: 8, padding: '8px 12px', marginBottom: 16,
              fontSize: 12, color: '#5C5A55', lineHeight: 1.6,
            }}>
              {current.tip}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={dismiss} style={{
              fontSize: 12, color: '#9B9890', background: 'none',
              border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
            }}>
              Skip tour
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 11, color: '#C4C2BC' }}>
                {step + 1} / {STEPS.length}
              </span>
              {step > 0 && (
                <button onClick={back} style={{
                  padding: '6px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 500,
                  background: 'transparent', border: '1px solid #E3E1DB', color: '#5C5A55',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  ← Back
                </button>
              )}
              <button onClick={next} style={{
                padding: '6px 18px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
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
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}
