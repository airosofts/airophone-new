'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

const C = {
  bg: '#F7F6F3', bg2: '#EFEDE8', surface: '#FFFFFF',
  border: '#E3E1DB', border2: '#D4D1C9',
  text: '#131210', text2: '#5C5A55', text3: '#9B9890',
  red: '#D63B1F', redBg: 'rgba(214,59,31,0.07)', redDim: 'rgba(214,59,31,0.14)',
  sans: "'Plus Jakarta Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",
}

function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="78" height="78" rx="17" stroke="#D63B1F" strokeWidth="2.5"/>
      <path d="M22 58L40 22L58 58" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M29 45H51" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round"/>
      <circle cx="57" cy="21" r="5" fill="#D63B1F"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
      background: C.redBg, border: `1px solid ${C.redDim}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  )
}

const focusHandler = (e) => { e.target.style.borderColor = C.red; e.target.style.boxShadow = `0 0 0 3px ${C.redDim}` }
const blurHandler = (e) => { e.target.style.borderColor = C.border2; e.target.style.boxShadow = 'none' }

const labelStyle = {
  display: 'block', fontFamily: C.mono, fontSize: '10.5px',
  color: C.text2, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 7,
}
const inputBaseStyle = {
  height: 42, border: `1px solid ${C.border2}`, borderRadius: 9,
  background: C.surface, fontFamily: C.sans, fontSize: 14, color: C.text, padding: '0 14px',
}

function SignupForm() {
  const searchParams = useSearchParams()
  const inviteEmail = searchParams.get('invite') || ''
  const inviteWid = searchParams.get('wid') || ''
  const inviteRoleParam = searchParams.get('role') || 'member'
  const refCode = searchParams.get('ref') || ''
  const method = searchParams.get('method') || ''

  const [mode, setMode] = useState(method === 'email' ? 'email' : 'choose')
  const autoGoogleFired = useRef(false)
  const [email, setEmail] = useState(inviteEmail)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const router = useRouter()

  useEffect(() => {
    if (inviteEmail) setEmail(inviteEmail)
  }, [inviteEmail])

  useEffect(() => {
    if (method === 'google' && !autoGoogleFired.current) {
      autoGoogleFired.current = true
      handleGoogleSignup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGoogleSignup = () => {
    // Preserve invite and referral params through Google OAuth round-trip
    if (inviteWid) {
      sessionStorage.setItem('invite_wid', inviteWid)
      sessionStorage.setItem('invite_role', inviteRoleParam)
    }
    if (refCode) {
      sessionStorage.setItem('referral_code', refCode)
    }
    const clientId = '167172022831-j9bjjeq43m4o2urp1ec3ovks5jvlaguk.apps.googleusercontent.com'
    const redirectUri = `${window.location.origin}/auth/callback`
    const scope = 'openid email profile'
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`
    window.location.href = url
  }

  const handleEmailSignup = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    if (password !== confirmPassword) { setError('Passwords do not match'); setLoading(false); return }
    if (password.length < 6) { setError('Password must be at least 6 characters'); setLoading(false); return }

    try {
      // Pull first-touch attribution captured on the landing page
      let attribution = null
      try { attribution = JSON.parse(localStorage.getItem('airo_attribution') || 'null') } catch {}

      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          name: email.split('@')[0],
          ...(inviteWid && { inviteWorkspaceId: inviteWid, inviteRole: inviteRoleParam }),
          ...(refCode && { referralCode: refCode }),
          ...(attribution && { attribution }),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Signup failed'); return }
      if (!data.session) { setError('Signup succeeded but no session was returned — please try logging in'); return }
      localStorage.setItem('user_session', JSON.stringify(data.session))
      try {
        const { identifyUser, trackEvent } = await import('@/lib/analytics')
        identifyUser(data.session)
        trackEvent('user_signed_up', { method: 'email', ...(attribution || {}) })
      } catch {}
      router.push(data.session.isInvited ? '/inbox' : '/onboarding')
    } catch (err) {
      setError(err?.message || 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" style={{ fontFamily: C.sans, WebkitFontSmoothing: 'antialiased' }}>

      {/* ═══ LEFT PANEL — Desktop only ═══ */}
      <div className="hidden lg:flex flex-1 flex-col justify-center items-start relative overflow-hidden"
        style={{ background: C.bg2, padding: '72px 80px 72px 10%', borderRight: `1px solid ${C.border}` }}>

        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
          backgroundSize: '40px 40px', opacity: 0.5,
        }} />
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'linear-gradient(160deg, transparent 40%, rgba(239,237,232,0.95) 100%)',
        }} />

        <div className="relative z-10">
          <div className="flex items-center gap-2.5 mb-12">
            <Logo size={34} />
            <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.03em', color: C.text }}>AiroPhone</span>
          </div>

          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.red, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>
            Start your free account
          </div>

          <h1 style={{ fontSize: 'clamp(26px, 2.6vw, 40px)', fontWeight: 600, color: C.text, lineHeight: 1.1, letterSpacing: '-0.04em', marginBottom: 14 }}>
            Everything you need<br />to communicate at <span style={{ color: C.red }}>scale.</span>
          </h1>

          <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.72, maxWidth: 340, fontWeight: 300, marginBottom: 32 }}>
            Get started in minutes. No credit card required. Full access to every feature on your free trial.
          </p>

          <div className="flex flex-col gap-2.5 mb-11">
            {['VoIP calling across multiple lines', 'Bulk SMS campaigns & scheduling', 'AI agent scenarios with auto-replies', 'Unified inbox & contact management'].map((f, i) => (
              <div key={i} className="flex items-center gap-2.5" style={{ fontSize: '13.5px', color: C.text2, fontWeight: 300 }}>
                <CheckIcon />{f}
              </div>
            ))}
          </div>

          <div className="flex gap-9 pt-7" style={{ borderTop: `1px solid ${C.border}` }}>
            {[
              { val: '99.9', unit: '%', label: 'Uptime' },
              { val: '2', unit: 'M+', label: 'Messages' },
              { val: '24', unit: '/7', label: 'Support' },
            ].map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.04em', color: C.text }}>
                  {s.val}<span style={{ color: C.red }}>{s.unit}</span>
                </div>
                <div style={{ fontFamily: C.mono, fontSize: 10, color: C.text3, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 3 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ RIGHT PANEL — Form ═══ */}
      <div className="w-full lg:w-135 lg:shrink-0 flex items-center justify-center px-6 py-10 sm:px-10 sm:py-14 lg:px-15"
        style={{ background: C.surface, minHeight: '100vh' }}>

        <div className="w-full max-w-100">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2.5 justify-center mb-10">
            <Logo size={30} />
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.03em', color: C.text }}>AiroPhone</span>
          </div>

          {/* ── CHOOSE MODE ── */}
          {mode === 'choose' && (
            <>
              {inviteEmail ? (
                <div className="mb-8">
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
                    padding: '10px 14px', borderRadius: 9,
                    background: C.redBg, border: `1px solid rgba(214,59,31,0.15)`,
                    fontSize: 13, color: C.red,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                    You were invited — create an account to join.
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 6 }}>
                    Accept your invitation
                  </div>
                  <div style={{ fontSize: '13.5px', color: C.text3 }}>
                    Choose how you&apos;d like to create your account
                  </div>
                </div>
              ) : (
                <div className="text-center mb-8">
                  <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 6 }}>
                    Welcome to AiroPhone!
                  </div>
                  <div style={{ fontSize: '13.5px', color: C.text3 }}>
                    Create an account to start your free trial
                  </div>
                </div>
              )}

              {/* Google */}
              <button onClick={handleGoogleSignup} className="w-full flex items-center justify-center gap-2.5 transition-colors"
                style={{ height: 46, border: `1px solid ${C.border2}`, borderRadius: 9, background: C.surface, cursor: 'pointer', fontSize: 14, fontWeight: 500, color: C.text, fontFamily: C.sans }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.text3; e.currentTarget.style.background = C.bg }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.background = C.surface }}
              >
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                Continue with Google
              </button>

              {/* Email */}
              <button onClick={() => { setMode('email'); if (inviteEmail) setEmail(inviteEmail) }} className="w-full flex items-center justify-center gap-2.5 mt-3 transition-colors"
                style={{ height: 46, border: `1px solid ${C.border2}`, borderRadius: 9, background: C.surface, cursor: 'pointer', fontSize: 14, fontWeight: 500, color: C.text, fontFamily: C.sans }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.text3; e.currentTarget.style.background = C.bg }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.background = C.surface }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="20" height="16" rx="3" stroke={C.red} strokeWidth="1.5"/>
                  <path d="M2 7l10 7 10-7" stroke={C.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Continue with email
              </button>

              {error && (
                <div className="mt-4 flex items-center gap-2" style={{ padding: '10px 14px', borderRadius: 9, background: C.redBg, border: `1px solid ${C.redDim}`, fontSize: 13, color: C.red }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                  {error}
                </div>
              )}

              <div className="my-7" style={{ height: 1, background: C.border }} />

              <div className="text-center">
                <div style={{ fontSize: 13, color: C.text3, marginBottom: 6 }}>Already have an account?</div>
                <Link href="/login" style={{ fontSize: 14, fontWeight: 500, color: C.red, textDecoration: 'none' }}>
                  Log back in
                </Link>
              </div>
            </>
          )}

          {/* ── EMAIL FORM ── */}
          {mode === 'email' && (
            <>
              <div className="mb-7">
                <button onClick={() => { setMode('choose'); setError(''); setSuccess('') }}
                  className="flex items-center gap-1.5 mb-5 p-0 bg-transparent border-none cursor-pointer"
                  style={{ color: C.text3, fontSize: 13 }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Back
                </button>
                <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 6 }}>
                  {inviteEmail ? 'Create with email' : 'Create your account'}
                </div>
                <div style={{ fontSize: '13.5px', color: C.text3 }}>
                  {inviteEmail ? 'Set a password to finish joining your team.' : 'Sign up with your email address'}
                </div>
              </div>

              <form onSubmit={handleEmailSignup}>
                <div className="mb-4">
                  <label style={labelStyle}>Email</label>
                  <input type="email" required value={email} onChange={(e) => !inviteEmail && setEmail(e.target.value)}
                    placeholder="you@company.com"
                    readOnly={!!inviteEmail}
                    className="w-full outline-none transition-all"
                    style={{ ...inputBaseStyle, background: inviteEmail ? C.bg : C.surface, color: C.text }}
                    onFocus={inviteEmail ? undefined : focusHandler} onBlur={inviteEmail ? undefined : blurHandler} />
                </div>

                <div className="mb-4">
                  <label style={labelStyle}>Password</label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} required value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full outline-none transition-all"
                      style={{ ...inputBaseStyle, paddingRight: 40 }} onFocus={focusHandler} onBlur={blurHandler} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 flex p-0 bg-transparent border-none cursor-pointer"
                      style={{ color: C.text3 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {showPassword
                          ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                          : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                        }
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="mb-4">
                  <label style={labelStyle}>Confirm Password</label>
                  <input type="password" required value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    className="w-full outline-none transition-all"
                    style={inputBaseStyle} onFocus={focusHandler} onBlur={blurHandler} />
                </div>

                {error && (
                  <div className="mb-4 flex items-center gap-2" style={{ padding: '10px 14px', borderRadius: 9, background: C.redBg, border: `1px solid ${C.redDim}`, fontSize: 13, color: C.red }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    {error}
                  </div>
                )}

                {success && (
                  <div className="mb-4 flex items-center gap-2" style={{ padding: '10px 14px', borderRadius: 9, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)', fontSize: 13, color: '#16a34a' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                      <circle cx="12" cy="12" r="10"/><polyline points="16 8 10 14 8 12"/>
                    </svg>
                    {success}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 transition-all mt-1.5"
                  style={{
                    height: 42, borderRadius: 9,
                    background: loading ? C.text3 : C.red, color: '#fff', border: 'none',
                    fontFamily: C.sans, fontSize: 14, fontWeight: 500,
                    cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '-0.01em',
                  }}
                  onMouseEnter={(e) => { if (!loading) e.currentTarget.style.opacity = '0.88' }}
                  onMouseLeave={(e) => { if (!loading) e.currentTarget.style.opacity = '1' }}
                >
                  {loading ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin">
                        <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Creating account...
                    </>
                  ) : (
                    <>
                      Create account
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </>
                  )}
                </button>
              </form>

              <div className="text-center mt-5" style={{ fontSize: 13, color: C.text3 }}>
                Already have an account?{' '}
                <Link href="/login" style={{ color: C.red, textDecoration: 'none' }}>Sign in</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}
