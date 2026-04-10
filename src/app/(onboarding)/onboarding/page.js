'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

const C = {
  bg: '#F7F6F3', bg2: '#EFEDE8', surface: '#FFFFFF',
  border: '#E3E1DB', border2: '#D4D1C9',
  text: '#131210', text2: '#5C5A55', text3: '#9B9890',
  red: '#D63B1F', redBg: 'rgba(214,59,31,0.07)', redDim: 'rgba(214,59,31,0.14)',
}

const btnPrimary = {
  width: '100%', height: 46, borderRadius: 9, background: C.red, color: '#fff', border: 'none',
  fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'opacity 0.15s',
  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
}
const btnSecondary = {
  width: '100%', height: 46, borderRadius: 9, background: 'transparent', color: C.text2,
  border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'color 0.15s',
  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
}
const inputStyle = {
  width: '100%', height: 44, border: `1px solid ${C.border2}`, borderRadius: 9,
  background: C.surface, fontSize: 14, color: C.text, padding: '0 14px', outline: 'none',
  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", transition: 'border-color 0.15s',
}
const selectStyle = { ...inputStyle, appearance: 'none', cursor: 'pointer',
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='%239B9890' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat', backgroundPosition: 'calc(100% - 14px) center',
}
const labelStyle = {
  display: 'block', fontSize: 14, fontWeight: 500, color: C.text, marginBottom: 8,
}

/* ── Progress Bar ── */
function ProgressBar({ step, totalSteps, isGoogleUser }) {
  const labels = isGoogleUser
    ? ['Welcome', 'Details', 'Plan & Payment']
    : ['Welcome', 'Details', 'Verify', 'Plan & Payment']
  const total = labels.length
  // Map real step to display step (Google skips verify)
  let displayStep = step
  if (isGoogleUser && step >= 3) displayStep = step - 1

  return (
    <div style={{ marginBottom: 40 }}>
      {/* Step labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        {labels.map((label, i) => {
          const idx = i + 1
          const isActive = displayStep >= idx
          const isCurrent = displayStep === idx
          return (
            <div key={i} style={{ flex: 1, textAlign: 'center' }}>
              <span style={{
                fontSize: 11, fontWeight: isCurrent ? 600 : 400,
                color: isActive ? C.red : C.text3,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.03em', textTransform: 'uppercase',
              }}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
      {/* Bar */}
      <div style={{ display: 'flex', gap: 4 }}>
        {labels.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: displayStep > i ? C.red : displayStep === i + 1 ? C.red : C.border,
            opacity: displayStep > i ? 1 : displayStep === i + 1 ? 0.4 : 1,
            transition: 'background 0.3s, opacity 0.3s',
          }} />
        ))}
      </div>
    </div>
  )
}

/* ── Pricing tiers (auto-applied by volume) ── */
function getRate(credits) {
  if (credits >= 10000) return { rate: 0.02, label: '$0.02', tier: 'Enterprise' }
  if (credits >= 5000) return { rate: 0.025, label: '$0.025', tier: 'Growth' }
  return { rate: 0.03, label: '$0.03', tier: 'Starter' }
}

const CREDIT_OPTIONS = [2, 500, 1000, 2000, 5000, 10000, 20000]

export default function OnboardingPage() {
  const [step, setStep] = useState(1)
  const [user, setUser] = useState(null)
  const [usageType, setUsageType] = useState(null)
  const router = useRouter()

  const [businessName, setBusinessName] = useState('')
  const [businessSize, setBusinessSize] = useState('')
  const [businessWebsite, setBusinessWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [heardFrom, setHeardFrom] = useState('')
  const [personalReason, setPersonalReason] = useState('')

  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const [isGoogleUser, setIsGoogleUser] = useState(false)

  const [creditAmount, setCreditAmount] = useState(1000)
  const [autoRecharge, setAutoRecharge] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const u = getCurrentUser()
    if (!u) { router.push('/login'); return }
    setUser(u)
    if (u.profile_photo_url?.includes('googleusercontent.com')) {
      setIsGoogleUser(true)
      setEmailVerified(true)
    }
  }, [])

  const userName = user?.name?.split(' ')[0] || 'there'

  const saveProgress = async (data) => {
    if (!user) return
    try {
      await fetch('/api/onboarding/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.userId, 'x-workspace-id': user.workspaceId },
        body: JSON.stringify(data),
      })
    } catch (e) { console.error('Save error:', e) }
  }

  const handleSendOtp = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/onboarding/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.userId },
        body: JSON.stringify({ email: user.email }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to send code'); return }
      setOtpSent(true)
    } catch { setError('Failed to send verification email') }
    finally { setLoading(false) }
  }

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 4) { setError('Enter the verification code'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/onboarding/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.userId, 'x-workspace-id': user.workspaceId },
        body: JSON.stringify({ code: otp }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Invalid code'); return }
      setEmailVerified(true)
      await saveProgress({ phone_verified: true })
      setTimeout(() => setStep(4), 800)
    } catch { setError('Verification failed') }
    finally { setLoading(false) }
  }

  const handleComplete = async (paymentMethodId, cardholderName) => {
    setSaving(true); setError('')
    const pricing = getRate(creditAmount)
    const totalCharge = (creditAmount * pricing.rate).toFixed(2)
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.userId, 'x-workspace-id': user.workspaceId },
        body: JSON.stringify({
          selected_plan: pricing.tier.toLowerCase(),
          credit_amount: creditAmount,
          rate_per_credit: pricing.rate,
          total_charge: totalCharge,
          auto_recharge: autoRecharge,
          payment_method_id: paymentMethodId,
          cardholder_name: cardholderName,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to complete setup'); setSaving(false); return }
      // Use window.location for a full reload so dashboard layout picks up the completed status
      window.location.href = '/inbox'
    } catch { setError('Something went wrong'); setSaving(false) }
  }

  if (!user) return null

  const totalSteps = isGoogleUser ? 3 : 4

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 24px 100px' }}>
      <div style={{ width: '100%', maxWidth: 520, textAlign: 'center' }}>

        {/* Progress bar */}
        <ProgressBar step={step} totalSteps={totalSteps} isGoogleUser={isGoogleUser} />

        {/* ── STEP 1: Welcome ── */}
        {step === 1 && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>&#128075;</div>
            <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 8 }}>
              Welcome {userName}!
            </h1>
            <p style={{ fontSize: 14, color: C.text3, lineHeight: 1.6, marginBottom: 40 }}>
              It&apos;s great to have you with us! To help us optimize your experience, tell us what you plan to use AiroPhone for.
            </p>

            {[
              { type: 'business', icon: '\uD83D\uDCCA', label: 'For business' },
              { type: 'personal', icon: '\uD83D\uDE0E', label: 'For personal use' },
            ].map(opt => (
              <button key={opt.type} onClick={() => { setUsageType(opt.type); saveProgress({ usage_type: opt.type }); setStep(2) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  padding: '16px 20px', marginBottom: 8,
                  border: `1px solid ${C.border}`, borderRadius: 10,
                  background: C.surface, cursor: 'pointer', textAlign: 'left',
                  fontSize: 15, fontWeight: 500, color: C.text,
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.background = C.bg }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.surface }}
              >
                <span style={{ fontSize: 22 }}>{opt.icon}</span>
                <span style={{ flex: 1 }}>{opt.label}</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke={C.text3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            ))}
          </>
        )}

        {/* ── STEP 2: Business Details ── */}
        {step === 2 && usageType === 'business' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>&#128188;</div>
            <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 8 }}>About your business</h1>
            <p style={{ fontSize: 14, color: C.text3, lineHeight: 1.6, marginBottom: 32 }}>Tell us about your business and who will be using AiroPhone.</p>
            <div style={{ textAlign: 'left' }}>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Business name</label>
                <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Your company" style={inputStyle} />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Business size</label>
                <select value={businessSize} onChange={e => setBusinessSize(e.target.value)} style={selectStyle}>
                  <option value="">Select...</option>
                  <option value="just-me">Just me</option>
                  <option value="2-10">2-10 employees</option>
                  <option value="11-50">11-50 employees</option>
                  <option value="51-200">51-200 employees</option>
                  <option value="200+">200+ employees</option>
                </select>
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Business website <span style={{ color: C.text3, fontWeight: 400 }}>(Optional)</span></label>
                <input value={businessWebsite} onChange={e => setBusinessWebsite(e.target.value)} placeholder="https://..." style={inputStyle} />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>How did you hear about us? <span style={{ color: C.text3, fontWeight: 400 }}>(Optional)</span></label>
                <select value={heardFrom} onChange={e => setHeardFrom(e.target.value)} style={selectStyle}>
                  <option value="">Select...</option>
                  <option value="google">Google search</option>
                  <option value="social">Social media</option>
                  <option value="referral">Referral / Word of mouth</option>
                  <option value="ad">Online ad</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Industry <span style={{ color: C.text3, fontWeight: 400 }}>(Optional)</span></label>
                <select value={industry} onChange={e => setIndustry(e.target.value)} style={selectStyle}>
                  <option value="">Select...</option>
                  <option value="real-estate">Real Estate</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="retail">Retail / E-commerce</option>
                  <option value="finance">Finance</option>
                  <option value="saas">SaaS / Technology</option>
                  <option value="agency">Marketing / Agency</option>
                  <option value="education">Education</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <button onClick={async () => {
              await saveProgress({ business_name: businessName, business_size: businessSize, business_website: businessWebsite, industry, heard_from: heardFrom })
              setStep(3)
            }} style={btnPrimary} onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }} onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}>Continue</button>
            <button onClick={() => setStep(1)} style={btnSecondary}>Go Back</button>
          </>
        )}

        {/* ── STEP 2: Personal Details ── */}
        {step === 2 && usageType === 'personal' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>&#128156;</div>
            <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 8 }}>About you</h1>
            <p style={{ fontSize: 14, color: C.text3, lineHeight: 1.6, marginBottom: 32 }}>Tell us about your needs so we can help you get started!</p>
            <div style={{ textAlign: 'left', marginBottom: 24 }}>
              <label style={labelStyle}>Why do you need AiroPhone? <span style={{ color: C.text3, fontWeight: 400 }}>(Optional)</span></label>
              <select value={personalReason} onChange={e => setPersonalReason(e.target.value)} style={selectStyle}>
                <option value="">Select...</option>
                <option value="second-number">A general purpose second number</option>
                <option value="signup-service">Signing up to another service</option>
                <option value="travel">Travelling or living abroad</option>
                <option value="other">Other</option>
              </select>
            </div>
            <button onClick={async () => {
              await saveProgress({ personal_reason: personalReason })
              setStep(3)
            }} style={btnPrimary} onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }} onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}>Continue</button>
            <button onClick={() => setStep(1)} style={btnSecondary}>Go Back</button>
          </>
        )}

        {/* ── STEP 3: Email Verification (skip for Google users) ── */}
        {step === 3 && (
          <>
            {isGoogleUser ? (
              (() => { setTimeout(() => setStep(4), 0); return null })()
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 16 }}>&#9993;&#65039;</div>
                <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 8 }}>Verify your email</h1>
                <p style={{ fontSize: 14, color: C.text3, lineHeight: 1.6, marginBottom: 8 }}>We&apos;ll send a verification code to</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 32, fontFamily: "'JetBrains Mono', monospace" }}>{user?.email}</p>

                {!emailVerified ? (
                  <div style={{ textAlign: 'left' }}>
                    {error && (
                      <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 9, background: C.redBg, border: `1px solid ${C.redDim}`, fontSize: 13, color: C.red }}>{error}</div>
                    )}
                    {!otpSent ? (
                      <button onClick={handleSendOtp} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
                        {loading ? 'Sending...' : 'Send verification code'}
                      </button>
                    ) : (
                      <>
                        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 9, fontSize: 13, color: '#16a34a' }}>
                          Code sent to {user?.email}
                        </div>
                        <label style={labelStyle}>Verification code</label>
                        <input value={otp} onChange={e => setOtp(e.target.value)} placeholder="Enter 6-digit code"
                          style={{ ...inputStyle, marginBottom: 12, letterSpacing: '0.2em', textAlign: 'center', fontSize: 20 }} maxLength={6} />
                        <button onClick={handleVerifyOtp} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
                          {loading ? 'Verifying...' : 'Verify'}
                        </button>
                        <button onClick={() => { setOtpSent(false); setOtp(''); setError('') }} style={{ ...btnSecondary, marginTop: 4 }}>Resend code</button>
                      </>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: 24, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 10 }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>&#9989;</div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#16a34a' }}>Email verified successfully!</p>
                  </div>
                )}
                <button onClick={() => setStep(2)} style={{ ...btnSecondary, marginTop: 8 }}>Go Back</button>
              </>
            )}
          </>
        )}

        {/* ── STEP 4: Plan & Payment ── */}
        {step === 4 && (() => {
          const pricing = getRate(creditAmount)
          const totalCharge = (creditAmount * pricing.rate).toFixed(2)
          return (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 8 }}>
              Set up billing
            </h1>
            <p style={{ fontSize: 14, color: C.text3, lineHeight: 1.6, marginBottom: 28 }}>
              You start with <strong style={{ color: C.text }}>50 free credits</strong>. Choose how many to auto-buy when they run out.
            </p>

            {/* How credits work */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1,
              background: C.border, border: `1px solid ${C.border}`, borderRadius: 10,
              overflow: 'hidden', marginBottom: 28,
            }}>
              {[
                { label: '1 SMS', cost: '1 credit' },
                { label: '1 min call', cost: '1 credit' },
                { label: '1 AI reply', cost: '2 credits' },
              ].map((item, i) => (
                <div key={i} style={{ background: C.surface, padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: C.text3, fontFamily: "'JetBrains Mono', monospace" }}>{item.cost}</div>
                </div>
              ))}
            </div>

            {/* Credits to buy */}
            <div style={{ textAlign: 'left', marginBottom: 20 }}>
              <label style={{
                display: 'block', fontFamily: "'JetBrains Mono', monospace",
                fontSize: '10.5px', color: C.text2, letterSpacing: '0.05em',
                textTransform: 'uppercase', marginBottom: 10,
              }}>Auto-buy credits when balance hits 0</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {CREDIT_OPTIONS.map(amt => {
                  const r = getRate(amt)
                  const isSelected = creditAmount === amt
                  return (
                    <button key={amt} onClick={() => setCreditAmount(amt)}
                      style={{
                        padding: '10px 16px', borderRadius: 8, cursor: 'pointer',
                        border: isSelected ? `2px solid ${C.red}` : `1px solid ${C.border}`,
                        background: isSelected ? C.redBg : C.surface,
                        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                        transition: 'all 0.15s', textAlign: 'center',
                      }}>
                      <div style={{
                        fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em',
                        color: isSelected ? C.red : C.text,
                      }}>{amt.toLocaleString()}</div>
                      <div style={{
                        fontSize: 10, color: isSelected ? C.red : C.text3, marginTop: 2,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>{r.label}/ea</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Pricing tiers explainer */}
            <div style={{
              background: C.bg2, borderRadius: 8, padding: '12px 16px',
              marginBottom: 20, textAlign: 'left',
            }}>
              <div style={{ fontSize: 11, color: C.text3, lineHeight: 1.6, fontFamily: "'JetBrains Mono', monospace" }}>
                1–4,999 credits = $0.03/credit &nbsp;&middot;&nbsp; 5,000–9,999 = $0.025 &nbsp;&middot;&nbsp; 10,000+ = $0.02
              </div>
            </div>

            {/* Summary box */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '18px 20px', marginBottom: 24, textAlign: 'left',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                    {creditAmount.toLocaleString()} credits
                  </div>
                  <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>
                    at {pricing.label}/credit ({pricing.tier} rate)
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', color: C.text }}>
                  ${totalCharge}
                </div>
              </div>
              <div style={{ height: 1, background: C.border, marginBottom: 12 }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Auto-recharge</div>
                  <div style={{ fontSize: 11, color: C.text3, marginTop: 1 }}>
                    Auto-charge <strong style={{ color: C.text }}>${totalCharge}</strong> when credits reach 0
                  </div>
                </div>
                <button onClick={() => setAutoRecharge(!autoRecharge)} style={{
                  width: 38, height: 21, borderRadius: 11, border: 'none', cursor: 'pointer',
                  background: autoRecharge ? C.red : C.border2,
                  position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                }}>
                  <div style={{
                    width: 15, height: 15, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 3,
                    left: autoRecharge ? 20 : 3, transition: 'left 0.2s',
                  }} />
                </button>
              </div>
            </div>

            {error && (
              <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 9, background: C.redBg, border: `1px solid ${C.redDim}`, fontSize: 13, color: C.red, textAlign: 'left' }}>
                {error}
              </div>
            )}

            {/* Card form */}
            <div style={{ textAlign: 'left', marginBottom: 16 }}>
              <Elements stripe={stripePromise}>
                <OnboardingCardForm onComplete={handleComplete} saving={saving} setError={setError} totalCharge={totalCharge} creditAmount={creditAmount} />
              </Elements>
            </div>

            <button onClick={() => setStep(isGoogleUser ? 2 : 3)} style={{ ...btnSecondary, marginTop: 4 }}>Go Back</button>
          </>
          )
        })()}
      </div>
    </div>
  )
}

/* ── Stripe card sub-component ── */
function OnboardingCardForm({ onComplete, saving, setError, totalCharge, creditAmount }) {
  const stripe = useStripe()
  const elements = useElements()
  const [name, setName] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!stripe || !elements) return
    if (!name.trim()) { setError('Enter cardholder name'); return }

    const { error: stripeError, paymentMethod } = await stripe.createPaymentMethod({
      type: 'card',
      card: elements.getElement(CardElement),
      billing_details: { name: name.trim() },
    })

    if (stripeError) { setError(stripeError.message); return }
    onComplete(paymentMethod.id, name.trim())
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: 14 }}>
        <label style={{
          display: 'block', fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10.5px', color: C.text2, letterSpacing: '0.05em',
          textTransform: 'uppercase', marginBottom: 7,
        }}>Cardholder name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name on card"
          style={{
            width: '100%', height: 42, border: `1px solid ${C.border2}`, borderRadius: 9,
            background: C.surface, fontSize: 14, color: C.text, padding: '0 14px', outline: 'none',
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          }} />
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={{
          display: 'block', fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10.5px', color: C.text2, letterSpacing: '0.05em',
          textTransform: 'uppercase', marginBottom: 7,
        }}>Card details</label>
        <div style={{ border: `1px solid ${C.border2}`, borderRadius: 9, padding: '12px 14px', background: C.surface }}>
          <CardElement options={{
            style: {
              base: { color: C.text, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '14px', '::placeholder': { color: C.text3 } },
              invalid: { color: C.red },
            }
          }} />
        </div>
      </div>
      <button type="submit" disabled={saving || !stripe}
        style={{
          width: '100%', height: 44, borderRadius: 9,
          background: saving ? C.text3 : C.text, color: '#fff', border: 'none',
          fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: saving ? 'not-allowed' : 'pointer',
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          letterSpacing: '-0.01em', transition: 'opacity 0.15s, transform 0.15s',
        }}
        onMouseEnter={e => { if (!saving) { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)' } }}
        onMouseLeave={e => { if (!saving) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' } }}>
        {saving ? 'Setting up your account...' : (
          <>
            Start free trial with 50 credits
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </>
        )}
      </button>
      <p style={{ textAlign: 'center', fontSize: 11, color: C.text3, marginTop: 12, lineHeight: 1.5 }}>
        Your card will be charged <strong style={{ color: C.text2 }}>${totalCharge}</strong> for {creditAmount?.toLocaleString()} credits when your 50 free credits run out. Cancel anytime.
      </p>
    </form>
  )
}
