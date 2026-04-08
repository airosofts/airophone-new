'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { loginWithEmailPassword } from '@/lib/auth'

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

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await loginWithEmailPassword(email, password)
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
        padding: '72px 64px',
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
            {'// calls · ai · bulk sms · all in one'}
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
        width: 460, flexShrink: 0, background: COLORS.surface,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '56px 48px',
      }} className="max-lg:!w-full max-lg:!p-8">

        <div style={{ width: '100%', maxWidth: 340 }}>

          {/* Mobile logo */}
          <div className="lg:hidden" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 40 }}>
            <Logo size={30} />
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.03em', color: COLORS.text }}>AiroPhone</span>
          </div>

          {/* Title */}
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', color: COLORS.text, marginBottom: 6 }}>
            Welcome back
          </div>
          <div style={{ fontSize: '13.5px', color: COLORS.text3, marginBottom: 32 }}>
            Sign in to your account
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
            <a href="#" style={{ color: COLORS.red, textDecoration: 'none' }}>Contact us</a>
          </div>
        </div>
      </div>
    </div>
  )
}
