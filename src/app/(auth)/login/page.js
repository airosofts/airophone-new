'use client'

import { useState, Suspense } from 'react'
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

function LoginForm() {
  const searchParams = useSearchParams()
  const widParam = searchParams.get('wid') || ''

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  const handleGoogleLogin = () => {
    // Store invite workspace param so we can use it after OAuth redirect
    if (widParam) {
      sessionStorage.setItem('invite_wid', widParam)
      sessionStorage.setItem('invite_role', 'member')
    }
    const clientId = '167172022831-j9bjjeq43m4o2urp1ec3ovks5jvlaguk.apps.googleusercontent.com'
    const redirectUri = `${window.location.origin}/auth/callback`
    const scope = 'openid email profile'
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`
    window.location.href = url
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invalid credentials')

      // If coming from an invite link, switch to the invited workspace
      if (widParam && data.session) {
        const targetWs = data.session.availableWorkspaces?.find(w => w.id === widParam)
        if (targetWs) {
          data.session.workspaceId = targetWs.id
          data.session.workspaceName = targetWs.name
          data.session.workspaceSlug = targetWs.slug
          data.session.workspaceRole = targetWs.role
        }
      }

      localStorage.setItem('user_session', JSON.stringify(data.session))
      try {
        const { identifyUser, trackEvent } = await import('@/lib/analytics')
        identifyUser(data.session)
        trackEvent('user_logged_in', { method: 'email' })
      } catch {}
      router.push('/inbox')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" style={{ fontFamily: C.sans, WebkitFontSmoothing: 'antialiased' }}>

      {/* ═══ LEFT PANEL — Desktop only ═══ */}
      <div className="hidden lg:flex flex-1 flex-col justify-center items-start relative overflow-hidden"
        style={{ background: C.bg2, padding: '72px 80px 72px 10%', borderRight: `1px solid ${C.border}` }}>

        {/* Grid pattern */}
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
            Calls · AI · Bulk SMS · All in one
          </div>

          <h1 style={{ fontSize: 'clamp(26px, 2.6vw, 40px)', fontWeight: 600, color: C.text, lineHeight: 1.1, letterSpacing: '-0.04em', marginBottom: 14 }}>
            Business calls &amp;<br />messaging, <span style={{ color: C.red }}>automated.</span>
          </h1>

          <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.72, maxWidth: 340, fontWeight: 300, marginBottom: 32 }}>
            Manage all your business conversations, run bulk campaigns, and let AI handle replies — 24/7.
          </p>

          <div className="flex flex-col gap-2.5 mb-11">
            {['VoIP calling across multiple lines', 'Bulk SMS with scheduling & personalization', 'AI agent scenarios — custom auto-replies'].map((f, i) => (
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

          {/* Title */}
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 6 }}>
            Welcome back
          </div>
          <div style={{ fontSize: '13.5px', color: C.text3, marginBottom: 28 }}>
            Sign in to your account
          </div>

          {/* Google */}
          <button onClick={handleGoogleLogin} className="w-full flex items-center justify-center gap-2.5 transition-colors"
            style={{
              height: 46, border: `1px solid ${C.border2}`, borderRadius: 9,
              background: C.surface, cursor: 'pointer',
              fontSize: 14, fontWeight: 500, color: C.text, fontFamily: C.sans,
            }}
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

          {/* Divider */}
          <div className="relative my-5">
            <div style={{ height: 1, background: C.border }} />
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3"
              style={{ background: C.surface, fontSize: 12, color: C.text3, fontFamily: C.mono }}>
              or
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label style={{ display: 'block', fontFamily: C.mono, fontSize: '10.5px', color: C.text2, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 7 }}>Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full outline-none transition-all"
                style={{ height: 42, border: `1px solid ${C.border2}`, borderRadius: 9, background: C.surface, fontFamily: C.sans, fontSize: 14, color: C.text, padding: '0 14px' }}
                onFocus={e => { e.target.style.borderColor = C.red; e.target.style.boxShadow = `0 0 0 3px ${C.redDim}` }}
                onBlur={e => { e.target.style.borderColor = C.border2; e.target.style.boxShadow = 'none' }}
              />
            </div>

            <div className="mb-4">
              <label style={{ display: 'block', fontFamily: C.mono, fontSize: '10.5px', color: C.text2, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 7 }}>Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} required value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full outline-none transition-all"
                  style={{ height: 42, border: `1px solid ${C.border2}`, borderRadius: 9, background: C.surface, fontFamily: C.sans, fontSize: 14, color: C.text, padding: '0 40px 0 14px' }}
                  onFocus={e => { e.target.style.borderColor = C.red; e.target.style.boxShadow = `0 0 0 3px ${C.redDim}` }}
                  onBlur={e => { e.target.style.borderColor = C.border2; e.target.style.boxShadow = 'none' }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex p-0 bg-transparent border-none cursor-pointer"
                  style={{ color: C.text3 }}>
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-4 flex items-center gap-2" style={{ padding: '10px 14px', borderRadius: 9, background: C.redBg, border: `1px solid ${C.redDim}`, fontSize: 13, color: C.red }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                {error}
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
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          <div className="text-center mt-5" style={{ fontSize: 13, color: C.text3 }}>
            Don&apos;t have an account?{' '}
            <Link href="/signup" style={{ color: C.red, textDecoration: 'none', fontWeight: 500 }}>Sign up now</Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
