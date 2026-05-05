'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser, updateSessionField } from '@/lib/auth'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

/* ══════════════════════════════════════════
   BRAND TOKENS
══════════════════════════════════════════ */
const C = {
  bg: '#F7F6F3', bg2: '#EFEDE8', surface: '#FFFFFF',
  border: '#E3E1DB', border2: '#D4D1C9',
  text: '#131210', text2: '#5C5A55', text3: '#9B9890',
  red: '#D63B1F', redBg: 'rgba(214,59,31,0.07)', redDim: 'rgba(214,59,31,0.15)',
  green: '#22c55e', greenBg: 'rgba(34,197,94,0.07)', greenBorder: 'rgba(34,197,94,0.15)',
  greenText: '#16a34a',
  sans: "'Plus Jakarta Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",
}

/* ══════════════════════════════════════════
   SHARED STYLES
══════════════════════════════════════════ */
const btnPrimary = {
  width: '100%', height: 48, borderRadius: 9, background: C.red, color: '#fff', border: 'none',
  fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'opacity 0.15s, transform 0.15s',
  fontFamily: C.sans, letterSpacing: '-0.01em',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
const btnSecondary = {
  height: 48, borderRadius: 9, background: 'transparent', color: C.text2,
  border: `1px solid ${C.border2}`, fontSize: 14, fontWeight: 400, cursor: 'pointer',
  transition: 'all 0.15s', fontFamily: C.sans,
  padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
}
const inputStyle = {
  width: '100%', height: 42, border: `1px solid ${C.border2}`, borderRadius: 9,
  background: C.surface, fontSize: 14, color: C.text, padding: '0 14px', outline: 'none',
  fontFamily: C.sans, transition: 'border-color 0.15s, box-shadow 0.15s', boxSizing: 'border-box',
}
const selectStyle = {
  ...inputStyle, appearance: 'none', cursor: 'pointer',
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='%239B9890' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat', backgroundPosition: 'calc(100% - 14px) center',
}
const labelStyle = {
  display: 'block', fontSize: '10.5px', fontWeight: 600, color: C.text2, marginBottom: 7,
  fontFamily: C.mono, letterSpacing: '0.05em', textTransform: 'uppercase',
}

const focusHandler = (e) => { e.target.style.borderColor = C.red; e.target.style.boxShadow = `0 0 0 3px ${C.redDim}` }
const blurHandler = (e) => { e.target.style.borderColor = C.border2; e.target.style.boxShadow = 'none' }

const COUNTRIES = [
  { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧' },
  { code: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺' },
  { code: 'PK', name: 'Pakistan', dial: '+92', flag: '🇵🇰' },
  { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳' },
  { code: 'AE', name: 'UAE', dial: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦' },
  { code: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dial: '+33', flag: '🇫🇷' },
  { code: 'NL', name: 'Netherlands', dial: '+31', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', dial: '+46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', dial: '+47', flag: '🇳🇴' },
  { code: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬' },
  { code: 'NZ', name: 'New Zealand', dial: '+64', flag: '🇳🇿' },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', dial: '+52', flag: '🇲🇽' },
  { code: 'ZA', name: 'South Africa', dial: '+27', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', dial: '+234', flag: '🇳🇬' },
  { code: 'PH', name: 'Philippines', dial: '+63', flag: '🇵🇭' },
]

const PLANS = [
  {
    id: 'starter', name: 'Starter', price: 9, credits: 200, overage: 0.04,
    priceId: 'price_1TLljUG8ztKaoxw1p9Taxc8W',
    features: ['200 credits / month', 'Unlimited calling', 'All features included', 'Unified inbox & AI scenarios', 'Phone number provisioning', '24/7 support & analytics'],
    featured: false,
  },
  {
    id: 'growth', name: 'Growth', price: 29, credits: 500, overage: 0.03,
    priceId: 'price_1TLljWG8ztKaoxw11Gi6wfQF',
    features: ['500 credits / month', 'Unlimited calling', 'All features included', 'Unified inbox & AI scenarios', 'Phone number provisioning', '24/7 support & analytics'],
    featured: true,
  },
  {
    id: 'enterprise', name: 'Enterprise', price: 59, credits: 1000, overage: 0.02,
    priceId: 'price_1TLljYG8ztKaoxw10g2MFLjV',
    features: ['1,000 credits / month', 'Unlimited calling', 'All features included', 'Unified inbox & AI scenarios', 'Phone number provisioning', '24/7 support & analytics'],
    featured: false,
  },
]

const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],
  ['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],
  ['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],
  ['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],
  ['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
  ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],
  ['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
  ['DC','District of Columbia'],
]

/* ══════════════════════════════════════════
   ICONS
══════════════════════════════════════════ */
const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const ArrowLeft = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M13 8H3M7 12l-4-4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const CheckIcon = ({ size = 10, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

/* ══════════════════════════════════════════
   PROGRESS BAR (mobile + desktop)
══════════════════════════════════════════ */
function ProgressBar({ step, isGoogleUser, isMobile, onBack }) {
  const labels = isGoogleUser
    ? ['Welcome', 'Details', 'Phone', 'Number', 'Billing']
    : ['Welcome', 'Details', 'Email', 'Phone', 'Number', 'Billing']
  let displayStep = step
  if (isGoogleUser && step >= 4) displayStep = step - 1
  const currentLabel = labels[displayStep - 1] || ''

  return (
    <div style={{ marginBottom: 32 }}>
      {isMobile ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          {onBack ? (
            <button onClick={onBack} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px',
              display: 'flex', alignItems: 'center', gap: 4, color: C.text2,
            }}>
              <ArrowLeft />
              <span style={{ fontSize: 11, fontFamily: C.sans, fontWeight: 500 }}>Back</span>
            </button>
          ) : (
            <span style={{ width: 44 }} />
          )}
          <span style={{ fontSize: 10, fontWeight: 600, color: C.red, fontFamily: C.mono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {currentLabel}
          </span>
          <span style={{ fontSize: 10, color: C.text3, fontFamily: C.mono, width: 44, textAlign: 'right' }}>
            {displayStep} / {labels.length}
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          {labels.map((label, i) => {
            const idx = i + 1
            const isActive = displayStep >= idx
            const isCurrent = displayStep === idx
            return (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <span style={{
                  fontSize: 10, fontWeight: isCurrent ? 600 : 400,
                  color: isActive ? C.red : C.text3,
                  fontFamily: C.mono, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  {label}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        {labels.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: displayStep > i ? C.red : displayStep === i + 1 ? C.redDim : C.border,
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   STEP HEADER
══════════════════════════════════════════ */
function StepHeader({ kicker, title, subtitle, isMobile }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        fontFamily: C.mono, fontSize: 11, fontWeight: 600, color: C.red,
        letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12,
      }}>
        {kicker}
      </div>
      <h1 style={{
        fontSize: isMobile ? 24 : 30, fontWeight: 600,
        letterSpacing: '-0.04em', color: C.text, marginBottom: 10, lineHeight: 1.15,
      }}>
        {title}
      </h1>
      {subtitle && (
        <p style={{ fontSize: 15, color: C.text2, lineHeight: 1.65, fontWeight: 300 }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════
   ERROR BANNER
══════════════════════════════════════════ */
function ErrorBanner({ error }) {
  if (!error) return null
  return (
    <div style={{
      marginBottom: 20, padding: '12px 16px', borderRadius: 10,
      background: C.redBg, border: `1px solid ${C.redDim}`,
      fontSize: 13, color: C.red, display: 'flex', alignItems: 'flex-start', gap: 8,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {error}
    </div>
  )
}

/* ══════════════════════════════════════════
   SUCCESS BANNER
══════════════════════════════════════════ */
function SuccessBanner({ title, subtitle }) {
  return (
    <div style={{
      padding: '20px 24px', background: C.greenBg, border: `1px solid ${C.greenBorder}`,
      borderRadius: 10, display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', background: 'rgba(34,197,94,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <CheckIcon size={16} color={C.greenText} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.greenText }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: C.greenText, opacity: 0.8, marginTop: 2 }}>{subtitle}</div>}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   SENT NOTICE
══════════════════════════════════════════ */
function SentNotice({ text }) {
  return (
    <div style={{
      marginBottom: 24, padding: '14px 16px', background: C.greenBg,
      border: `1px solid ${C.greenBorder}`, borderRadius: 10,
      fontSize: 13, color: C.greenText, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <CheckIcon size={14} color={C.greenText} />
      {text}
    </div>
  )
}

/* ══════════════════════════════════════════
   OTP INPUT
══════════════════════════════════════════ */
function OtpInput({ value, onChange, length = 6 }) {
  const digits = value.split('').concat(Array(length).fill('')).slice(0, length)

  const handleKeyDown = (e, idx) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const arr = value.split('').concat(Array(length).fill('')).slice(0, length)
      if (arr[idx]) {
        // Clear current box and stay
        arr[idx] = ''
        onChange(arr.join('').trimEnd())
      } else if (idx > 0) {
        // Box already empty — move to previous and clear it
        arr[idx - 1] = ''
        onChange(arr.join('').trimEnd())
        const prev = e.target.parentNode.children[idx - 1]
        if (prev) prev.focus()
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault()
      e.target.parentNode.children[idx - 1].focus()
    } else if (e.key === 'ArrowRight' && idx < length - 1) {
      e.preventDefault()
      e.target.parentNode.children[idx + 1].focus()
    }
  }

  const handleInput = (e, idx) => {
    const val = e.target.value.replace(/\D/g, '')
    if (!val) return
    const chars = val.split('')
    const arr = value.split('').concat(Array(length).fill('')).slice(0, length)
    if (chars.length > 1) {
      // paste via typing multiple chars
      const pasted = val.slice(0, length)
      onChange(pasted)
      const lastIdx = Math.min(pasted.length, length) - 1
      const boxes = e.target.parentNode.children
      if (boxes[lastIdx]) boxes[lastIdx].focus()
      return
    }
    arr[idx] = chars[0]
    onChange(arr.join('').trimEnd())
    if (idx < length - 1) {
      const next = e.target.parentNode.children[idx + 1]
      if (next) next.focus()
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, length)
    if (pasted) {
      onChange(pasted)
      const boxes = e.target.parentNode.children
      const lastIdx = Math.min(pasted.length, length) - 1
      if (boxes[lastIdx]) boxes[lastIdx].focus()
    }
  }

  const boxStyle = {
    width: 48, height: 56, borderRadius: 10,
    border: `1px solid ${C.border2}`, background: C.surface,
    fontSize: 22, fontWeight: 600, fontFamily: C.mono,
    color: C.text, textAlign: 'center', outline: 'none',
    caretColor: C.red,
    transition: 'border-color 0.15s, box-shadow 0.15s',
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <label style={labelStyle}>Verification code</label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {digits.map((d, i) => (
          <input
            key={i}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onInput={e => handleInput(e, i)}
            onKeyDown={e => handleKeyDown(e, i)}
            onPaste={handlePaste}
            onClick={e => e.target.select()}
            onFocus={e => { e.target.select(); e.target.style.borderColor = C.red; e.target.style.boxShadow = `0 0 0 3px ${C.redDim}` }}
            onBlur={e => { e.target.style.borderColor = C.border2; e.target.style.boxShadow = 'none' }}
            style={{ ...boxStyle, borderColor: d ? C.red : C.border2 }}
          />
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   BUTTON PAIR
══════════════════════════════════════════ */
function ButtonPair({ onBack, onNext, nextLabel = 'Continue', loading = false, backLabel = 'Back', nextDisabled = false }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
      {onBack && (
        <button onClick={onBack} style={btnSecondary}>
          <ArrowLeft /> {backLabel}
        </button>
      )}
      {onNext && (
        <button
          onClick={onNext}
          disabled={loading || nextDisabled}
          style={{
            ...btnPrimary, flex: 1,
            opacity: loading || nextDisabled ? 0.6 : 1,
            cursor: loading || nextDisabled ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={e => { if (!loading && !nextDisabled) e.currentTarget.style.opacity = '0.88' }}
          onMouseLeave={e => { if (!loading && !nextDisabled) e.currentTarget.style.opacity = '1' }}
        >
          {loading ? 'Loading...' : <>{nextLabel} <ArrowRight /></>}
        </button>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════
   MAIN ONBOARDING PAGE
══════════════════════════════════════════ */
export default function OnboardingPage() {
  const [ready, setReady] = useState(false)
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
  const [otpResent, setOtpResent] = useState(false)
  const [otp, setOtp] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const [isGoogleUser, setIsGoogleUser] = useState(false)

  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0])
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [whatsappOtpSent, setWhatsappOtpSent] = useState(false)
  const [whatsappOtpResent, setWhatsappOtpResent] = useState(false)
  const [whatsappOtp, setWhatsappOtp] = useState('')
  const [whatsappVerified, setWhatsappVerified] = useState(false)
  const [whatsappLoading, setWhatsappLoading] = useState(false)

  const [selectedPlan, setSelectedPlan] = useState('growth')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [searchState, setSearchState] = useState('')
  const [searchCity, setSearchCity] = useState('')
  const [availableNumbers, setAvailableNumbers] = useState([])
  const [searchingNumbers, setSearchingNumbers] = useState(false)
  const [purchasingNumber, setPurchasingNumber] = useState(null)
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState(null)

  useEffect(() => {
    const u = getCurrentUser()
    if (!u) { router.replace('/login'); return }
    setUser(u)
    if (u.auth_provider === 'google') {
      setIsGoogleUser(true)
      setEmailVerified(true)
    }
    setReady(true)
  }, [])

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => { setError('') }, [step])

  // Google users skip email verification (step 3) — advance automatically
  useEffect(() => {
    if (step === 3 && isGoogleUser) setStep(4)
  }, [step, isGoogleUser])

  const userName = user?.name?.split(' ')[0] || 'there'
  const totalSteps = isGoogleUser ? 5 : 6

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

  const handleSendWhatsappOtp = async () => {
    const local = whatsappPhone.trim().replace(/[\s\-()]/g, '')
    if (!local || !/^\d{5,14}$/.test(local)) {
      setError('Enter a valid phone number'); return
    }
    const phone = `${selectedCountry.dial}${local}`
    setWhatsappLoading(true); setError('')
    try {
      const res = await fetch('/api/onboarding/send-whatsapp-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.userId },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to send code'); return }
      setWhatsappOtpSent(true)
    } catch { setError('Failed to send verification code') }
    finally { setWhatsappLoading(false) }
  }

  const handleVerifyWhatsappOtp = async () => {
    if (!whatsappOtp || whatsappOtp.length < 5) { setError('Enter the 5-digit verification code'); return }
    setWhatsappLoading(true); setError('')
    try {
      const res = await fetch('/api/onboarding/verify-whatsapp-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.userId, 'x-workspace-id': user.workspaceId },
        body: JSON.stringify({ phone: `${selectedCountry.dial}${whatsappPhone.trim().replace(/[\s\-()]/g, '')}`, code: whatsappOtp }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Invalid code'); return }
      setWhatsappVerified(true)
      await saveProgress({ whatsapp_verified: true, whatsapp_phone: `${selectedCountry.dial}${whatsappPhone.trim().replace(/[\s\-()]/g, '')}` })
      setTimeout(() => setStep(5), 800)
    } catch { setError('Verification failed') }
    finally { setWhatsappLoading(false) }
  }

  const handleComplete = async (paymentMethodId, cardholderName, plan, couponId) => {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.userId, 'x-workspace-id': user.workspaceId },
        body: JSON.stringify({
          plan_name: plan.id, price_id: plan.priceId,
          payment_method_id: paymentMethodId, cardholder_name: cardholderName,
          coupon_id: couponId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to complete setup'); setSaving(false); return }
      // Upgrade session so messagingProfileId is populated if already set
      let currentUser = user
      const upgradeRes = await fetch('/api/auth/session-upgrade', { headers: { 'x-user-id': user.userId } })
      if (upgradeRes.ok) {
        const upgradeData = await upgradeRes.json()
        if (upgradeData.success) {
          const upgraded = { ...user, ...upgradeData.session }
          localStorage.setItem('user_session', JSON.stringify(upgraded))
          setUser(upgraded)
          currentUser = upgraded
        }
      }

      // Provision messaging profile if not already created
      let profileId = currentUser.messagingProfileId
      if (!profileId) {
        const profileRes = await fetch('/api/onboarding/provision-messaging', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.userId, 'x-workspace-id': currentUser.workspaceId },
          body: JSON.stringify({ profileName: businessName || currentUser.name }),
        })
        const profileData = await profileRes.json()
        if (profileRes.ok && profileData.messaging_profile_id) {
          profileId = profileData.messaging_profile_id
          const updated = updateSessionField('messagingProfileId', profileId)
          if (updated) { setUser(updated); currentUser = updated }
        }
      }

      // Purchase the pre-selected phone number
      if (selectedPhoneNumber) {
        const purchaseRes = await fetch('/api/telnyx/purchase-number', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUser.userId,
            'x-workspace-id': currentUser.workspaceId,
            'x-messaging-profile-id': profileId || '',
          },
          body: JSON.stringify({ phoneNumber: selectedPhoneNumber.phone_number, upfrontCost: 1.00, monthlyCost: 1.00, vat: 0.30, totalCost: 2.30 }),
        })
        const purchaseData = await purchaseRes.json()
        if (!purchaseRes.ok || !purchaseData.success) {
          // Non-fatal — billing succeeded, number can be purchased from settings
          console.warn('Number purchase failed after billing:', purchaseData.error)
        }
      }

      setSaving(false)
      window.location.href = '/inbox'
    } catch { setError('Something went wrong'); setSaving(false) }
  }

  if (!ready || !user) return null

  /* ════════════════════════════════════════
     RENDER
  ════════════════════════════════════════ */
  return (
    <div style={{
      minHeight: 'calc(100vh - 56px)',
      background: C.bg,
      display: 'flex', justifyContent: 'center',
      padding: isMobile ? '24px 16px 80px' : '52px 24px 100px',
      fontFamily: C.sans,
    }}>
      <div style={{
        width: '100%',
        maxWidth: isMobile ? '100%' : (step === 6 ? 1020 : 620),
      }}>
        <ProgressBar
          step={step}
          isGoogleUser={isGoogleUser}
          isMobile={isMobile}
          onBack={isMobile && step > 1 ? () => {
            if (step === 2) setStep(1)
            else if (step === 3) setStep(2)
            else if (step === 4) setStep(isGoogleUser ? 2 : 3)
            else if (step === 5) setStep(4)
            else if (step === 6) setStep(5)
          } : null}
        />

          {/* ════════════════════════════════════
             STEP 1: Welcome
          ════════════════════════════════════ */}
          {step === 1 && (
            <>
              <StepHeader
                kicker={`Step 1 of ${totalSteps}`}
                title={<>Welcome, <span style={{ color: C.red }}>{userName}</span></>}
                subtitle="Let us know how you plan to use AiroPhone so we can tailor your setup."
                isMobile={isMobile}
              />

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
                {[
                  {
                    type: 'business',
                    label: 'For business',
                    desc: 'Teams, customer communication, campaigns',
                    icon: (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
                      </svg>
                    )
                  },
                  {
                    type: 'personal',
                    label: 'For personal use',
                    desc: 'Second number, privacy, travel',
                    icon: (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                    )
                  },
                ].map(opt => (
                  <button key={opt.type}
                    onClick={() => { setUsageType(opt.type); saveProgress({ usage_type: opt.type }); setStep(2) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 16, width: '100%',
                      padding: '24px 22px',
                      border: `1px solid ${C.border}`, borderRadius: 12,
                      background: C.surface, cursor: 'pointer', textAlign: 'left',
                      fontFamily: C.sans, transition: 'all 0.15s',
                      boxShadow: 'none',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.boxShadow = `0 0 0 3px ${C.redBg}` }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'none' }}
                  >
                    <div style={{
                      width: 48, height: 48, borderRadius: 12, background: C.redBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      border: `1px solid ${C.redDim}`,
                    }}>
                      {opt.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 3, letterSpacing: '-0.01em' }}>{opt.label}</div>
                      <div style={{ fontSize: 13, color: C.text3, fontWeight: 300 }}>{opt.desc}</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M6 4l4 4-4 4" stroke={C.text3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ════════════════════════════════════
             STEP 2: Business Details
          ════════════════════════════════════ */}
          {step === 2 && usageType === 'business' && (
            <>
              <StepHeader
                kicker={`Step 2 of ${totalSteps}`}
                title="About your business"
                subtitle="Tell us about your business so we can tailor your setup."
                isMobile={isMobile}
              />

              <div style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                padding: isMobile ? 20 : 28,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 14 : 18 }}>
                  <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}>
                    <label style={labelStyle}>Business name</label>
                    <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Your company" style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
                  </div>
                  <div>
                    <label style={labelStyle}>Business size</label>
                    <select value={businessSize} onChange={e => setBusinessSize(e.target.value)} style={selectStyle}>
                      <option value="">Select...</option>
                      <option value="just-me">Just me</option>
                      <option value="2-10">2–10 employees</option>
                      <option value="11-50">11–50 employees</option>
                      <option value="51-200">51–200 employees</option>
                      <option value="200+">200+ employees</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Industry <span style={{ color: C.text3, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
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
                  <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}>
                    <label style={labelStyle}>Business website <span style={{ color: C.text3, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                    <input value={businessWebsite} onChange={e => setBusinessWebsite(e.target.value)} placeholder="https://" style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
                  </div>
                  <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}>
                    <label style={labelStyle}>How did you hear about us? <span style={{ color: C.text3, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                    <select value={heardFrom} onChange={e => setHeardFrom(e.target.value)} style={selectStyle}>
                      <option value="">Select...</option>
                      <option value="google">Google search</option>
                      <option value="social">Social media</option>
                      <option value="referral">Referral / Word of mouth</option>
                      <option value="ad">Online ad</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
              </div>

              <ButtonPair
                onBack={() => setStep(1)}
                onNext={async () => {
                  await saveProgress({ business_name: businessName, business_size: businessSize, business_website: businessWebsite, industry, heard_from: heardFrom })
                  setStep(3)
                }}
              />
            </>
          )}

          {/* ════════════════════════════════════
             STEP 2: Personal Details
          ════════════════════════════════════ */}
          {step === 2 && usageType === 'personal' && (
            <>
              <StepHeader
                kicker={`Step 2 of ${totalSteps}`}
                title="About you"
                subtitle="Help us understand your needs so we can get you set up quickly."
                isMobile={isMobile}
              />

              <div style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                padding: isMobile ? 20 : 28,
              }}>
                <label style={labelStyle}>Why do you need AiroPhone? <span style={{ color: C.text3, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                <select value={personalReason} onChange={e => setPersonalReason(e.target.value)} style={selectStyle}>
                  <option value="">Select...</option>
                  <option value="second-number">A general purpose second number</option>
                  <option value="signup-service">Signing up to another service</option>
                  <option value="travel">Travelling or living abroad</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <ButtonPair
                onBack={() => setStep(1)}
                onNext={async () => { await saveProgress({ personal_reason: personalReason }); setStep(3) }}
              />
            </>
          )}

          {/* ════════════════════════════════════
             STEP 3: Email Verification
          ════════════════════════════════════ */}
          {step === 3 && (
            <>
              {isGoogleUser ? null : (
                <>
                  <StepHeader
                    kicker="Step 3 of 6"
                    title="Verify your email"
                    subtitle={<>We will send a 6-digit code to <span style={{ fontWeight: 600, color: C.text, fontFamily: C.mono }}>{user?.email}</span></>}
                    isMobile={isMobile}
                  />

                  <div style={{
                    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                    padding: isMobile ? 20 : 28,
                  }}>
                    <ErrorBanner error={error} />

                    {!emailVerified ? (
                      <>
                        {!otpSent ? (
                          <button onClick={handleSendOtp} disabled={loading}
                            style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
                            onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.88' }}
                            onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = '1' }}>
                            {loading ? 'Sending...' : <>Send verification code <ArrowRight /></>}
                          </button>
                        ) : (
                          <>
                            <SentNotice text={otpResent ? `New code resent to ${user?.email}` : `Code sent to ${user?.email}`} />
                            <OtpInput value={otp} onChange={setOtp} />
                            <div style={{ display: 'flex', gap: 10 }}>
                              <button onClick={() => { setOtp(''); setError(''); setOtpResent(true); handleSendOtp() }} disabled={loading} style={btnSecondary}>
                                {loading ? 'Sending...' : 'Resend'}
                              </button>
                              <button onClick={handleVerifyOtp} disabled={loading}
                                style={{ ...btnPrimary, flex: 1, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
                                onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.88' }}
                                onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = '1' }}>
                                {loading ? 'Verifying...' : 'Verify code'}
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      <SuccessBanner title="Email verified" subtitle="Redirecting to next step..." />
                    )}
                  </div>

                  <button onClick={() => setStep(2)} style={{ ...btnSecondary, marginTop: 14, width: 'auto' }}>
                    <ArrowLeft /> Back
                  </button>
                </>
              )}
            </>
          )}

          {/* ════════════════════════════════════
             STEP 4: Phone Verification
          ════════════════════════════════════ */}
          {step === 4 && (
            <>
              <StepHeader
                kicker={`Step ${isGoogleUser ? 3 : 4} of ${totalSteps}`}
                title="Verify your phone"
                subtitle="We will send a 6-digit verification code to confirm your identity."
                isMobile={isMobile}
              />

              <div style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                padding: isMobile ? 20 : 28,
              }}>
                <ErrorBanner error={error} />

                {!whatsappVerified ? (
                  <>
                    {!whatsappOtpSent ? (
                      <>
                        <div style={{ marginBottom: 20 }}>
                          <label style={labelStyle}>Phone number</label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <select
                              value={selectedCountry.code}
                              onChange={e => setSelectedCountry(COUNTRIES.find(c => c.code === e.target.value))}
                              style={{
                                height: 42, border: `1px solid ${C.border2}`, borderRadius: 9,
                                background: C.surface, fontSize: 14, color: C.text,
                                padding: '0 32px 0 12px', outline: 'none', cursor: 'pointer',
                                fontFamily: C.sans, appearance: 'none',
                                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239B9890' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
                                backgroundRepeat: 'no-repeat', backgroundPosition: 'calc(100% - 10px) center',
                                minWidth: 100,
                              }}
                            >
                              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.dial}</option>)}
                            </select>
                            <input
                              value={whatsappPhone}
                              onChange={e => setWhatsappPhone(e.target.value)}
                              placeholder="555 000 0000"
                              style={{ ...inputStyle, flex: 1 }}
                              onFocus={focusHandler} onBlur={blurHandler}
                            />
                          </div>
                          <div style={{ fontSize: 12, color: C.text3, marginTop: 8, fontWeight: 300 }}>
                            Select your country code, then enter your number without the leading 0
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button onClick={() => { setStep(isGoogleUser ? 2 : 3); setError('') }} style={btnSecondary}>
                            <ArrowLeft /> Back
                          </button>
                          <button onClick={handleSendWhatsappOtp} disabled={whatsappLoading}
                            style={{ ...btnPrimary, flex: 1, opacity: whatsappLoading ? 0.6 : 1, cursor: whatsappLoading ? 'not-allowed' : 'pointer' }}
                            onMouseEnter={e => { if (!whatsappLoading) e.currentTarget.style.opacity = '0.88' }}
                            onMouseLeave={e => { if (!whatsappLoading) e.currentTarget.style.opacity = '1' }}>
                            {whatsappLoading ? 'Sending...' : <>Send verification code <ArrowRight /></>}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <SentNotice text={whatsappOtpResent ? `New code resent to ${selectedCountry.dial} ${whatsappPhone}` : `Code sent to ${selectedCountry.dial} ${whatsappPhone} via SMS`} />
                        <OtpInput value={whatsappOtp} onChange={setWhatsappOtp} length={5} />
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button onClick={() => { setWhatsappOtp(''); setError(''); setWhatsappOtpResent(true); handleSendWhatsappOtp() }} disabled={whatsappLoading} style={btnSecondary}>
                            {whatsappLoading ? 'Sending...' : 'Resend'}
                          </button>
                          <button onClick={handleVerifyWhatsappOtp} disabled={whatsappLoading}
                            style={{ ...btnPrimary, flex: 1, opacity: whatsappLoading ? 0.6 : 1, cursor: whatsappLoading ? 'not-allowed' : 'pointer' }}
                            onMouseEnter={e => { if (!whatsappLoading) e.currentTarget.style.opacity = '0.88' }}
                            onMouseLeave={e => { if (!whatsappLoading) e.currentTarget.style.opacity = '1' }}>
                            {whatsappLoading ? 'Verifying...' : 'Verify code'}
                          </button>
                        </div>
                        <button
                          onClick={() => { setWhatsappOtpSent(false); setWhatsappOtp(''); setError('') }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', marginTop: 14, fontSize: 13, color: C.text3, fontFamily: C.sans, padding: 0, textDecoration: 'underline' }}
                        >
                          Wrong number? Change it
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <SuccessBanner title="Phone verified" subtitle="Redirecting to next step..." />
                )}
              </div>
            </>
          )}

          {/* ════════════════════════════════════
             STEP 5: Get a Phone Number
          ════════════════════════════════════ */}
          {step === 5 && (
            <>
              <StepHeader
                kicker={`Step ${isGoogleUser ? 4 : 5} of ${totalSteps}`}
                title="Get your phone number"
                subtitle="Search for a US phone number by state or city. This will be your number for calls and messages."
                isMobile={isMobile}
              />

              {/* Number search */}
              <div style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                padding: isMobile ? 20 : 28,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14, marginBottom: 16 }}>
                  <div>
                    <label style={labelStyle}>State</label>
                    <select value={searchState} onChange={e => setSearchState(e.target.value)} style={selectStyle}>
                      <option value="">All States</option>
                      {US_STATES.map(([val, name]) => <option key={val} value={val}>{name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>City <span style={{ color: C.text3, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                    <input value={searchCity} onChange={e => setSearchCity(e.target.value)} placeholder="e.g. Dallas" style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
                  </div>
                </div>

                <button
                  onClick={async () => {
                    setSearchingNumbers(true); setError(''); setAvailableNumbers([])
                    try {
                      const params = new URLSearchParams()
                      params.set('country_code', 'US')
                      if (searchState) params.set('administrative_area', searchState)
                      if (searchCity) params.set('locality', searchCity)
                      const res = await fetch(`/api/telnyx/search-numbers?${params}`)
                      const data = await res.json()
                      if (data.success && data.numbers?.length > 0) {
                        setAvailableNumbers(data.numbers)
                      } else {
                        setAvailableNumbers([])
                        setError('No numbers found. Try a different state or city.')
                      }
                    } catch { setError('Failed to search numbers') }
                    finally { setSearchingNumbers(false) }
                  }}
                  disabled={searchingNumbers}
                  style={{ ...btnPrimary, marginBottom: 18, opacity: searchingNumbers ? 0.6 : 1, cursor: searchingNumbers ? 'not-allowed' : 'pointer' }}
                  onMouseEnter={e => { if (!searchingNumbers) e.currentTarget.style.opacity = '0.88' }}
                  onMouseLeave={e => { if (!searchingNumbers) e.currentTarget.style.opacity = '1' }}
                >
                  {searchingNumbers ? 'Searching...' : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      Search available numbers
                    </>
                  )}
                </button>

                <ErrorBanner error={error} />
              </div>

              {availableNumbers.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{
                    fontFamily: C.mono, fontSize: 10.5, color: C.text3,
                    letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12,
                  }}>
                    {availableNumbers.length} numbers available — pick one to continue
                  </div>
                  <div style={{
                    border: `1px solid ${C.border}`, borderRadius: 12,
                    overflow: 'hidden', background: C.surface,
                  }}>
                    <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                      {availableNumbers.slice(0, 25).map((num, i) => {
                        const phone = num.phone_number
                        const digits = phone.replace(/\D/g, '')
                        const local = digits.startsWith('1') ? digits.slice(1) : digits
                        const formatted = local.length === 10 ? `(${local.slice(0,3)}) ${local.slice(3,6)}-${local.slice(6)}` : phone
                        const isChosen = selectedPhoneNumber?.phone_number === phone
                        const features = []
                        if (num.features?.find(f => f.name === 'sms')) features.push('SMS')
                        if (num.features?.find(f => f.name === 'voice')) features.push('Voice')
                        if (num.features?.find(f => f.name === 'mms')) features.push('MMS')

                        return (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '14px 18px',
                            borderBottom: i < Math.min(availableNumbers.length, 25) - 1 ? `1px solid ${C.border}` : 'none',
                            background: isChosen ? C.redBg : C.surface,
                            transition: 'background 0.1s',
                          }}
                            onMouseEnter={e => { if (!isChosen) e.currentTarget.style.background = C.bg }}
                            onMouseLeave={e => { e.currentTarget.style.background = isChosen ? C.redBg : C.surface }}
                          >
                            <div>
                              <div style={{ fontSize: 15, fontWeight: 600, color: isChosen ? C.red : C.text, fontFamily: C.mono, letterSpacing: '0.01em' }}>
                                {formatted}
                              </div>
                              <div style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'center' }}>
                                {num.locality && <span style={{ fontSize: 12, color: C.text3, fontWeight: 300 }}>{num.locality}{num.administrative_area ? `, ${num.administrative_area}` : ''}</span>}
                                {features.map(f => (
                                  <span key={f} style={{
                                    fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                                    fontFamily: C.mono, textTransform: 'uppercase', letterSpacing: '0.05em',
                                    background: f === 'SMS' ? C.redBg : f === 'Voice' ? C.greenBg : C.bg2,
                                    color: f === 'SMS' ? C.red : f === 'Voice' ? C.greenText : C.text3,
                                  }}>{f}</span>
                                ))}
                              </div>
                            </div>
                            <button
                              onClick={() => { setSelectedPhoneNumber(num); setError('') }}
                              style={{
                                padding: '8px 20px', borderRadius: 8, flexShrink: 0,
                                background: isChosen ? C.red : C.text,
                                color: '#fff', border: 'none', fontSize: 13, fontWeight: 500,
                                cursor: 'pointer', fontFamily: C.sans, transition: 'opacity 0.15s',
                                letterSpacing: '-0.01em',
                              }}
                            >
                              {isChosen ? 'Selected' : 'Select'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {/* Sticky selected number + continue bar inside the list box */}
                  {selectedPhoneNumber && (() => {
                    const d = selectedPhoneNumber.phone_number.replace(/\D/g, '')
                    const loc = d.startsWith('1') ? d.slice(1) : d
                    const fmt = loc.length === 10 ? `(${loc.slice(0,3)}) ${loc.slice(3,6)}-${loc.slice(6)}` : selectedPhoneNumber.phone_number
                    return (
                      <div style={{
                        borderTop: `1px solid ${C.redDim}`, background: C.redBg,
                        padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.red, fontFamily: C.mono }}>{fmt}</span>
                          <span style={{ fontSize: 12, color: C.text2 }}>selected</span>
                        </div>
                        <span style={{ fontSize: 12, color: C.red, fontWeight: 500 }}>✓ Ready to continue</span>
                      </div>
                    )
                  })()}

                  <p style={{ fontSize: 12, color: C.text3, marginTop: 10, lineHeight: 1.5, fontWeight: 300 }}>
                    Your first number is included in your plan. Pick one, then continue to billing.
                  </p>
                </div>
              )}

              {/* Continue to billing */}
              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button onClick={() => setStep(4)} style={btnSecondary}>
                  <ArrowLeft /> Back
                </button>
                <button
                  onClick={() => selectedPhoneNumber && setStep(6)}
                  disabled={!selectedPhoneNumber}
                  style={{ ...btnPrimary, flex: 1, opacity: selectedPhoneNumber ? 1 : 0.4, cursor: selectedPhoneNumber ? 'pointer' : 'not-allowed' }}
                  onMouseEnter={e => { if (selectedPhoneNumber) e.currentTarget.style.opacity = '0.88' }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = selectedPhoneNumber ? '1' : '0.4' }}
                >
                  Continue to billing <ArrowRight />
                </button>
              </div>
            </>
          )}

          {/* ════════════════════════════════════
             STEP 6: Plan & Payment
          ════════════════════════════════════ */}
          {step === 6 && (
            <>
              <StepHeader
                kicker={`Step ${isGoogleUser ? 5 : 6} of ${totalSteps} — Final step`}
                title="Choose your plan"
                subtitle="Start free for 7 days. No charge until your trial ends. Cancel anytime."
                isMobile={isMobile}
              />

              {/* Selected number reminder */}
              {selectedPhoneNumber && (() => {
                const digits = selectedPhoneNumber.phone_number.replace(/\D/g, '')
                const local = digits.startsWith('1') ? digits.slice(1) : digits
                const formatted = local.length === 10 ? `(${local.slice(0,3)}) ${local.slice(3,6)}-${local.slice(6)}` : selectedPhoneNumber.phone_number
                return (
                  <div style={{
                    padding: '12px 16px', background: C.redBg, border: `1px solid ${C.redDim}`,
                    borderRadius: 10, fontSize: 13, color: C.text2, marginBottom: 20,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 20 20" fill={C.red} style={{ flexShrink: 0 }}><path d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/></svg>
                    <span>Your number: <strong style={{ fontWeight: 600, fontFamily: C.mono }}>{formatted}</strong> — included free in your plan</span>
                  </div>
                )
              })()}

              {/* Plan cards */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                gap: 16, marginBottom: 28,
              }}>
                {PLANS.map(plan => {
                  const isSelected = selectedPlan === plan.id
                  return (
                    <button key={plan.id} onClick={() => setSelectedPlan(plan.id)}
                      style={{
                        display: 'flex', flexDirection: 'column',
                        padding: '24px 22px',
                        border: isSelected ? `2px solid ${C.red}` : `1px solid ${C.border}`,
                        borderRadius: 14, background: isSelected ? C.redBg : C.surface,
                        cursor: 'pointer', textAlign: 'left', width: '100%',
                        fontFamily: C.sans, transition: 'all 0.15s', position: 'relative',
                        boxShadow: isSelected ? `0 0 0 4px ${C.redBg}` : 'none',
                      }}>
                      {plan.featured && (
                        <div style={{
                          position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                          background: C.red, color: '#fff', fontSize: 9, fontWeight: 600,
                          padding: '3px 12px', borderRadius: '0 0 8px 8px',
                          fontFamily: C.mono, letterSpacing: '0.08em', textTransform: 'uppercase',
                        }}>
                          Most Popular
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, marginTop: plan.featured ? 8 : 0 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: isSelected ? C.red : C.text, letterSpacing: '-0.02em' }}>{plan.name}</span>
                        <div style={{
                          width: 20, height: 20, borderRadius: '50%',
                          border: isSelected ? `6px solid ${C.red}` : `2px solid ${C.border2}`,
                          background: C.surface, transition: 'all 0.15s', flexShrink: 0,
                        }} />
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                          <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.04em', color: isSelected ? C.red : C.text, lineHeight: 1 }}>${plan.price}</span>
                          <span style={{ fontSize: 13, color: C.text3, marginLeft: 4 }}>/month</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.text3, marginTop: 4, fontWeight: 300 }}>
                          {plan.credits.toLocaleString()} credits included
                        </div>
                      </div>

                      <div style={{ height: 1, background: isSelected ? C.redDim : C.border, marginBottom: 16 }} />

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
                        {plan.features.map(f => (
                          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{
                              width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                              background: isSelected ? C.red : C.bg2,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                <path d="M2 5l2 2 4-4" stroke={isSelected ? '#fff' : C.text3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </div>
                            <span style={{ fontSize: 12.5, color: isSelected ? C.text : C.text2, lineHeight: 1.4, fontWeight: 300 }}>{f}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginTop: 16, fontSize: 11, color: C.text3, fontFamily: C.mono }}>
                        ${plan.overage}/extra credit
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Trial notice */}
              <div style={{
                padding: '12px 16px', background: C.greenBg, border: `1px solid ${C.greenBorder}`,
                borderRadius: 10, fontSize: 13, color: C.greenText, marginBottom: 24,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>
                  <strong style={{ fontWeight: 600 }}>7-day free trial</strong> — your card will not be charged until{' '}
                  {new Date(Date.now() + 7*24*60*60*1000).toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'})}
                </span>
              </div>

              <ErrorBanner error={error} />

              {/* Payment form */}
              <div style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                padding: isMobile ? '20px' : '28px',
              }}>
                <div style={{
                  fontFamily: C.mono, fontSize: 10, color: C.text3,
                  letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 18,
                }}>
                  Payment details
                </div>
                <Elements stripe={stripePromise}>
                  <OnboardingCardForm
                    onComplete={(pmId, name, couponId) => handleComplete(pmId, name, PLANS.find(p => p.id === selectedPlan), couponId)}
                    saving={saving}
                    setError={setError}
                    selectedPlan={PLANS.find(p => p.id === selectedPlan)}
                  />
                </Elements>
              </div>

              <button onClick={() => setStep(5)} style={{ ...btnSecondary, marginTop: 14, width: 'auto' }}>
                <ArrowLeft /> Back
              </button>
            </>
          )}

        </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   STRIPE CARD FORM
══════════════════════════════════════════ */
function OnboardingCardForm({ onComplete, saving, setError, selectedPlan }) {
  const stripe = useStripe()
  const elements = useElements()
  const [name, setName] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [couponApplied, setCouponApplied] = useState(null) // { id, code, discount_type, discount_value, description }
  const [couponError, setCouponError] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)

  const discountedPrice = couponApplied
    ? couponApplied.discount_type === 'percent'
      ? (selectedPlan?.price * (1 - couponApplied.discount_value / 100)).toFixed(2)
      : Math.max(0, selectedPlan?.price - couponApplied.discount_value).toFixed(2)
    : null

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const session = localStorage.getItem('user_session')
      const s = session ? JSON.parse(session) : {}
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': s.userId || '',
          'x-workspace-id': s.workspaceId || '',
        },
        body: JSON.stringify({ code: couponCode.trim(), plan_name: selectedPlan?.id }),
      })
      const data = await res.json()
      if (!res.ok) { setCouponError(data.error || 'Invalid coupon'); return }
      setCouponApplied(data.coupon)
      setCouponCode('')
    } catch { setCouponError('Failed to apply coupon') }
    finally { setCouponLoading(false) }
  }

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
    onComplete(paymentMethod.id, name.trim(), couponApplied?.id || null)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Cardholder name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name on card"
            style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
        </div>
        <div>
          <label style={labelStyle}>Card details</label>
          <div style={{
            border: `1px solid ${C.border2}`, borderRadius: 9,
            padding: '12px 14px', background: C.surface,
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}>
            <CardElement options={{
              style: {
                base: { color: C.text, fontFamily: C.sans, fontSize: '14px', '::placeholder': { color: C.text3 } },
                invalid: { color: C.red },
              }
            }} />
          </div>
        </div>

        {/* Coupon */}
        <div>
          <label style={labelStyle}>Coupon code <span style={{ color: C.text3, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
          {couponApplied ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: 9,
              background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><polyline points="16 8 10 14 8 12"/>
              </svg>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', fontFamily: C.mono }}>{couponApplied.code}</span>
                <span style={{ fontSize: 12, color: '#16a34a', marginLeft: 8 }}>
                  — {couponApplied.discount_type === 'percent' ? `${couponApplied.discount_value}% off` : `$${couponApplied.discount_value} off`}
                  {couponApplied.description ? ` · ${couponApplied.description}` : ''}
                </span>
              </div>
              <button type="button" onClick={() => setCouponApplied(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', fontSize: 12, padding: 0 }}>
                Remove
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={couponCode}
                onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponError('') }}
                placeholder="ENTER CODE"
                style={{ ...inputStyle, flex: 1, fontFamily: C.mono, letterSpacing: '0.05em' }}
                onFocus={focusHandler} onBlur={blurHandler}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleApplyCoupon() } }}
              />
              <button type="button" onClick={handleApplyCoupon} disabled={!couponCode.trim() || couponLoading}
                style={{
                  height: 42, padding: '0 16px', borderRadius: 9, border: `1px solid ${C.border2}`,
                  background: C.surface, fontSize: 13, fontWeight: 500, color: C.text2,
                  cursor: couponCode.trim() && !couponLoading ? 'pointer' : 'not-allowed',
                  opacity: couponCode.trim() && !couponLoading ? 1 : 0.5,
                  fontFamily: C.sans, whiteSpace: 'nowrap',
                }}>
                {couponLoading ? 'Checking...' : 'Apply'}
              </button>
            </div>
          )}
          {couponError && (
            <p style={{ marginTop: 6, fontSize: 12, color: C.red }}>{couponError}</p>
          )}
        </div>
      </div>

      {/* Price summary */}
      {couponApplied && (
        <div style={{
          padding: '12px 14px', borderRadius: 9,
          background: C.bg, border: `1px solid ${C.border}`,
          marginBottom: 16, fontSize: 13,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: C.text2, marginBottom: 4 }}>
            <span>{selectedPlan?.name} plan</span>
            <span>${selectedPlan?.price}/mo</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a', marginBottom: 4 }}>
            <span>Coupon ({couponApplied.code})</span>
            <span>−{couponApplied.discount_type === 'percent' ? `${couponApplied.discount_value}%` : `$${couponApplied.discount_value}`}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: C.text, fontWeight: 600, borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 4 }}>
            <span>Total after trial</span>
            <span>${discountedPrice}/mo</span>
          </div>
        </div>
      )}

      <button type="submit" disabled={saving || !stripe}
        style={{
          ...btnPrimary, height: 50, fontSize: 15, fontWeight: 600,
          background: saving ? C.text3 : C.red,
          cursor: saving ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={e => { if (!saving) e.currentTarget.style.opacity = '0.88' }}
        onMouseLeave={e => { if (!saving) e.currentTarget.style.opacity = '1' }}>
        {saving ? 'Setting up your account...' : <>Start 7-day free trial <ArrowRight /></>}
      </button>
      <p style={{ textAlign: 'center', fontSize: 12, color: C.text3, marginTop: 12, lineHeight: 1.6, fontWeight: 300 }}>
        No charge until {new Date(Date.now() + 7*24*60*60*1000).toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'})}. Then <strong style={{ fontWeight: 600 }}>${couponApplied ? discountedPrice : selectedPlan?.price}/month</strong> for {selectedPlan?.name} plan.
      </p>
    </form>
  )
}
