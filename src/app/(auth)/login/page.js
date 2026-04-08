'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { loginWithEmailPassword } from '@/lib/auth'

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

  return (
    <div className="min-h-screen flex overflow-hidden" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>

      {/* ── LEFT PANEL ── */}
      <div
        className="hidden lg:flex lg:flex-1 relative overflow-hidden flex-col justify-center items-start"
        style={{
          background: '#EFEDE8',
          borderRight: '1px solid #E3E1DB',
          padding: '72px 64px',
        }}
      >
        {/* Grid pattern */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(#E3E1DB 1px, transparent 1px), linear-gradient(90deg, #E3E1DB 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            opacity: 0.5,
          }}
        />
        {/* Gradient fade overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(160deg, transparent 40%, rgba(239,237,232,0.95) 100%)',
          }}
        />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-2.5 mb-[52px]">
          <svg width="34" height="34" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="78" height="78" rx="17" stroke="#D63B1F" strokeWidth="2.5"/>
            <path d="M22 58L40 22L58 58" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M29 45H51" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round"/>
            <circle cx="57" cy="21" r="5" fill="#D63B1F"/>
          </svg>
          <span className="text-[17px] font-semibold tracking-tight" style={{ color: '#131210', letterSpacing: '-0.03em' }}>
            AiroPhone
          </span>
        </div>

        {/* Content */}
        <div className="relative z-10">
          <div
            className="mb-3.5"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              color: '#D63B1F',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            // calls &middot; ai &middot; bulk sms &middot; all in one
          </div>

          <h1
            className="mb-3.5"
            style={{
              fontSize: 'clamp(26px, 2.6vw, 40px)',
              fontWeight: 600,
              color: '#131210',
              lineHeight: 1.1,
              letterSpacing: '-0.04em',
            }}
          >
            Business calls &amp;<br />messaging, <span style={{ color: '#D63B1F' }}>automated.</span>
          </h1>

          <p
            className="mb-8"
            style={{
              fontSize: '14px',
              color: '#5C5A55',
              lineHeight: 1.72,
              maxWidth: '340px',
              fontWeight: 300,
            }}
          >
            Manage all your business conversations, run bulk campaigns, and let AI handle replies — 24/7.
          </p>

          {/* Feature checklist */}
          <div className="flex flex-col gap-2.5 mb-11">
            {[
              'VoIP calling across multiple lines',
              'Bulk SMS with scheduling & personalization',
              'AI agent scenarios — custom auto-replies',
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-2.5" style={{ fontSize: '13.5px', color: '#5C5A55', fontWeight: 300 }}>
                <div
                  className="flex-shrink-0 flex items-center justify-center"
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: 'rgba(214,59,31,0.07)',
                    border: '1px solid rgba(214,59,31,0.14)',
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#D63B1F" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                {feature}
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="flex gap-9 pt-7" style={{ borderTop: '1px solid #E3E1DB' }}>
            {[
              { val: '99.9', unit: '%', label: 'Uptime' },
              { val: '2', unit: 'M+', label: 'Messages' },
              { val: '24', unit: '/7', label: 'Support' },
            ].map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-0.04em', color: '#131210' }}>
                  {s.val}<span style={{ color: '#D63B1F' }}>{s.unit}</span>
                </div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '10px',
                    color: '#9B9890',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    marginTop: '3px',
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL — LOGIN FORM ── */}
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          width: '460px',
          background: '#FFFFFF',
          padding: '56px 48px',
        }}
      >
        {/* On mobile, take full width */}
        <style jsx>{`
          @media (max-width: 1023px) {
            div[style*="width: 460px"] {
              width: 100% !important;
              padding: 32px 24px !important;
            }
          }
        `}</style>

        <div className="w-full" style={{ maxWidth: '340px' }}>
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-10 justify-center">
            <svg width="30" height="30" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="78" height="78" rx="17" stroke="#D63B1F" strokeWidth="2.5"/>
              <path d="M22 58L40 22L58 58" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M29 45H51" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round"/>
              <circle cx="57" cy="21" r="5" fill="#D63B1F"/>
            </svg>
            <span className="text-base font-semibold" style={{ color: '#131210', letterSpacing: '-0.03em' }}>AiroPhone</span>
          </div>

          {/* Header */}
          <h2
            className="mb-1.5"
            style={{
              fontSize: '24px',
              fontWeight: 600,
              letterSpacing: '-0.03em',
              color: '#131210',
            }}
          >
            Welcome back
          </h2>
          <p className="mb-8" style={{ fontSize: '13.5px', color: '#9B9890' }}>
            Sign in to your account
          </p>

          {/* Form */}
          <form onSubmit={handleLogin}>
            {/* Email */}
            <div className="mb-[18px]">
              <label
                className="block mb-[7px]"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '10.5px',
                  color: '#5C5A55',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full outline-none transition-all"
                style={{
                  height: '42px',
                  border: '1px solid #D4D1C9',
                  borderRadius: '9px',
                  background: '#FFFFFF',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  fontSize: '14px',
                  color: '#131210',
                  padding: '0 14px',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#D63B1F'
                  e.target.style.boxShadow = '0 0 0 3px rgba(214,59,31,0.14)'
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#D4D1C9'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </div>

            {/* Password */}
            <div className="mb-[18px]">
              <label
                className="block mb-[7px]"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '10.5px',
                  color: '#5C5A55',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full outline-none transition-all"
                  style={{
                    height: '42px',
                    border: '1px solid #D4D1C9',
                    borderRadius: '9px',
                    background: '#FFFFFF',
                    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                    fontSize: '14px',
                    color: '#131210',
                    padding: '0 40px 0 14px',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#D63B1F'
                    e.target.style.boxShadow = '0 0 0 3px rgba(214,59,31,0.14)'
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#D4D1C9'
                    e.target.style.boxShadow = 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex"
                  style={{ color: '#9B9890', cursor: 'pointer', background: 'none', border: 'none' }}
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
              <div
                className="mb-4 flex items-center gap-2 px-3.5 py-3 rounded-[9px]"
                style={{
                  background: 'rgba(214,59,31,0.07)',
                  border: '1px solid rgba(214,59,31,0.14)',
                  fontSize: '13px',
                  color: '#D63B1F',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 transition-all"
              style={{
                height: '42px',
                borderRadius: '9px',
                background: loading ? '#9B9890' : '#D63B1F',
                color: '#fff',
                border: 'none',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: '14px',
                fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                marginTop: '6px',
                letterSpacing: '-0.01em',
                opacity: loading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => { if (!loading) e.target.style.opacity = '0.88' }}
              onMouseLeave={(e) => { if (!loading) e.target.style.opacity = '1' }}
            >
              {loading ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
          <p className="text-center mt-5" style={{ fontSize: '13px', color: '#9B9890' }}>
            Don&apos;t have an account?{' '}
            <a href="#" style={{ color: '#D63B1F', textDecoration: 'none' }}>
              Contact us
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
