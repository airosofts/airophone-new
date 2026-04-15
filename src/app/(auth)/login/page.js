'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
// Auth is handled via API route which sets httpOnly cookie

const COLORS = {
  bg: '#F7F6F3',
  bg2: '#EFEDE8',
  surface: '#FFFFFF',
  border: '#E3E1DB',
  border2: '#D4D1C9',
  text: '#131210',
  text2: '#5C5A55',
  text3: '#9B9890',
  red: '#D63B1F',
  redBg: 'rgba(214,59,31,0.07)',
  redDim: 'rgba(214,59,31,0.14)',
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
      background: COLORS.redBg, border: `1px solid ${COLORS.redDim}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={COLORS.red} strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  )
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  const handleGoogleLogin = () => {
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
      // Cache session in localStorage for client-side reads
      localStorage.setItem('user_session', JSON.stringify(data.session))
      router.push('/inbox')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%',
    height: 42,
    border: `1px solid ${COLORS.border2}`,
    borderRadius: 9,
    background: COLORS.surface,
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    fontSize: 14,
    color: COLORS.text,
    padding: '0 14px',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  }

  const labelStyle = {
    display: 'block',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10.5px',
    color: COLORS.text2,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    marginBottom: 7,
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      overflow: 'hidden',
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      WebkitFontSmoothing: 'antialiased',
    }}>

      {/* ═══ LEFT PANEL ═══ */}
      <div style={{
        flex: 1,
        background: COLORS.bg2,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '72px 80px 72px 10%',
        position: 'relative',
        overflow: 'hidden',
        borderRight: `1px solid ${COLORS.border}`,
      }} className="hidden lg:flex">

        {/* Grid pattern */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `linear-gradient(${COLORS.border} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border} 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
          opacity: 0.5,
        }} />

        {/* Gradient fade */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(160deg, transparent 40%, rgba(239,237,232,0.95) 100%)',
        }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 52, position: 'relative', zIndex: 1 }}>
          <Logo size={34} />
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.03em', color: COLORS.text }}>
            AiroPhone
          </span>
        </div>

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Kicker */}
          <div className="mono" style={{
            fontSize: 11, color: COLORS.red,
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14,
          }}>
            {'Calls · AI · Bulk SMS · All in one'}
          </div>

          {/* Heading */}
          <h1 style={{
            fontSize: 'clamp(26px, 2.6vw, 40px)', fontWeight: 600,
            color: COLORS.text, lineHeight: 1.1, letterSpacing: '-0.04em', marginBottom: 14,
          }}>
            Business calls &amp;<br />messaging, <span style={{ color: COLORS.red, fontStyle: 'normal' }}>automated.</span>
          </h1>

          {/* Subtitle */}
          <p style={{
            fontSize: 14, color: COLORS.text2, lineHeight: 1.72,
            maxWidth: 340, fontWeight: 300, marginBottom: 32,
          }}>
            Manage all your business conversations, run bulk campaigns, and let AI handle replies — 24/7.
          </p>

          {/* Features */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 44 }}>
            {[
              'VoIP calling across multiple lines',
              'Bulk SMS with scheduling & personalization',
              'AI agent scenarios — custom auto-replies',
            ].map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13.5px', color: COLORS.text2, fontWeight: 300 }}>
                <CheckIcon />
                {f}
              </div>
            ))}
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 36, paddingTop: 28, borderTop: `1px solid ${COLORS.border}` }}>
            {[
              { val: '99.9', unit: '%', label: 'Uptime' },
              { val: '2', unit: 'M+', label: 'Messages' },
              { val: '24', unit: '/7', label: 'Support' },
            ].map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.04em', color: COLORS.text }}>
                  {s.val}<span style={{ color: COLORS.red }}>{s.unit}</span>
                </div>
                <div className="mono" style={{
                  fontSize: 10, color: COLORS.text3,
                  letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 3,
                }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ RIGHT PANEL — FORM ═══ */}
      <div style={{
        width: 540, flexShrink: 0, background: COLORS.surface,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '56px 60px',
      }} className="max-lg:!w-full max-lg:!p-8">

        <div style={{ width: '100%', maxWidth: 400 }}>

          {/* Title */}
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', color: COLORS.text, marginBottom: 6 }}>
            Welcome back
          </div>
          <div style={{ fontSize: '13.5px', color: COLORS.text3, marginBottom: 28 }}>
            Sign in to your account
          </div>

          {/* Google login */}
          <button onClick={handleGoogleLogin} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', height: 46, border: `1px solid ${COLORS.border2}`, borderRadius: 9,
            background: COLORS.surface, cursor: 'pointer',
            fontSize: 14, fontWeight: 500, color: COLORS.text,
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            transition: 'border-color 0.15s, background 0.15s', marginBottom: 0,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#9B9890'; e.currentTarget.style.background = '#F7F6F3' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border2; e.currentTarget.style.background = COLORS.surface }}
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
          <div style={{ textAlign: 'center', margin: '20px 0', position: 'relative' }}>
            <div style={{ height: 1, background: COLORS.border }} />
            <span style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: COLORS.surface, padding: '0 12px',
              fontSize: 12, color: COLORS.text3,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              or
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin}>

            {/* Email */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                style={inputStyle}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  style={{ ...inputStyle, paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    color: COLORS.text3, cursor: 'pointer', display: 'flex',
                    background: 'none', border: 'none', padding: 0,
                  }}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 9,
                background: COLORS.redBg, border: `1px solid ${COLORS.redDim}`,
                fontSize: 13, color: COLORS.red,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {error}
              </div>
            )}

            {/* Button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', height: 42, borderRadius: 9,
                background: loading ? COLORS.text3 : COLORS.red,
                color: '#fff', border: 'none',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 14, fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                marginTop: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                letterSpacing: '-0.01em',
                transition: 'opacity 0.15s, transform 0.15s',
              }}
              onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)' } }}
              onMouseLeave={(e) => { if (!loading) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' } }}
            >
              {loading ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: COLORS.text3 }}>
            Don&apos;t have an account?{' '}
            <Link href="/signup" style={{ color: COLORS.red, textDecoration: 'none', fontWeight: 500 }}>Sign up now</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
