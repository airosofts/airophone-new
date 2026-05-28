'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const C = {
  bg: '#F7F6F3', bg2: '#EFEDE8', surface: '#FFFFFF',
  border: '#E3E1DB', border2: '#D4D1C9',
  text: '#131210', text2: '#5C5A55', text3: '#9B9890',
  red: '#D63B1F', redBg: 'rgba(214,59,31,0.07)', redDim: 'rgba(214,59,31,0.14)',
  green: '#1F8C4A', greenBg: 'rgba(31,140,74,0.07)', greenDim: 'rgba(31,140,74,0.16)',
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

const inputStyle = {
  height: 42, border: `1px solid ${C.border2}`, borderRadius: 9,
  background: C.surface, fontFamily: C.sans, fontSize: 14, color: C.text, padding: '0 14px',
}
const labelStyle = {
  display: 'block', fontFamily: C.mono, fontSize: '10.5px', color: C.text2,
  letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 7,
}
const onFocus = e => { e.target.style.borderColor = C.red; e.target.style.boxShadow = `0 0 0 3px ${C.redDim}` }
const onBlur  = e => { e.target.style.borderColor = C.border2; e.target.style.boxShadow = 'none' }

function ErrorBox({ children }) {
  return (
    <div className="mb-4 flex items-center gap-2" style={{
      padding: '10px 14px', borderRadius: 9, background: C.redBg,
      border: `1px solid ${C.redDim}`, fontSize: 13, color: C.red,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      {children}
    </div>
  )
}

function SuccessBox({ children }) {
  return (
    <div className="mb-4 flex items-center gap-2" style={{
      padding: '10px 14px', borderRadius: 9, background: C.greenBg,
      border: `1px solid ${C.greenDim}`, fontSize: 13, color: C.green,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {children}
    </div>
  )
}

function PrimaryButton({ loading, disabled, children, type = 'submit', onClick, loadingLabel }) {
  return (
    <button type={type} disabled={loading || disabled} onClick={onClick}
      className="w-full flex items-center justify-center gap-2 transition-all mt-1.5"
      style={{
        height: 42, borderRadius: 9,
        background: (loading || disabled) ? C.text3 : C.red, color: '#fff', border: 'none',
        fontFamily: C.sans, fontSize: 14, fontWeight: 500,
        cursor: (loading || disabled) ? 'not-allowed' : 'pointer', letterSpacing: '-0.01em',
      }}
      onMouseEnter={(e) => { if (!loading && !disabled) e.currentTarget.style.opacity = '0.88' }}
      onMouseLeave={(e) => { if (!loading && !disabled) e.currentTarget.style.opacity = '1' }}
    >
      {loading ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin">
            <circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          {loadingLabel || 'Working...'}
        </>
      ) : (
        <>
          {children}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </>
      )}
    </button>
  )
}

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [step, setStep] = useState(1) // 1: email, 2: code, 3: new password, 4: done
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [googleAccount, setGoogleAccount] = useState(false)

  async function handleSendCode(e) {
    e?.preventDefault()
    setError(''); setNotice(''); setGoogleAccount(false); setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send code')
      // This email signed up with Google — there's no password to reset.
      if (data.googleAccount) {
        setGoogleAccount(true)
        return
      }
      setStep(2)
      setNotice(`We sent a code to ${email}. Check your inbox.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(e) {
    e?.preventDefault()
    setError(''); setNotice(''); setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invalid code')
      setStep(3)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e) {
    e?.preventDefault()
    setError(''); setNotice('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reset password')
      setStep(4)
      setTimeout(() => router.push('/login'), 1800)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: C.bg, fontFamily: C.sans, WebkitFontSmoothing: 'antialiased', padding: '40px 24px' }}>

      <div className="w-full max-w-100" style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
        padding: '36px 32px', boxShadow: '0 2px 16px rgba(19,18,16,0.04)',
      }}>

        {/* Logo */}
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <Logo size={32} />
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.03em', color: C.text }}>AiroPhone</span>
        </div>

        {/* Step header */}
        <div style={{
          fontFamily: C.mono, fontSize: 10, fontWeight: 500, color: C.red,
          letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, textAlign: 'center',
        }}>
          {step < 4 ? `Step ${step} of 3` : 'All set'}
        </div>

        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', color: C.text, marginBottom: 6, textAlign: 'center' }}>
          {step === 1 && (googleAccount ? 'Use Google to sign in' : 'Forgot your password?')}
          {step === 2 && 'Enter the code'}
          {step === 3 && 'Set a new password'}
          {step === 4 && 'Password updated'}
        </div>
        <div style={{ fontSize: '13.5px', color: C.text3, marginBottom: 24, textAlign: 'center', lineHeight: 1.5 }}>
          {step === 1 && !googleAccount && 'Enter your email and we’ll send you a verification code.'}
          {step === 2 && `We sent a 6-digit code to ${email}. It expires in 15 minutes.`}
          {step === 3 && 'Choose a strong password — at least 6 characters.'}
          {step === 4 && 'Redirecting you to sign in…'}
        </div>

        {error && <ErrorBox>{error}</ErrorBox>}
        {notice && !error && step === 2 && <SuccessBox>{notice}</SuccessBox>}

        {/* ─── STEP 1: email ───────────────────────────── */}
        {step === 1 && !googleAccount && (
          <form onSubmit={handleSendCode}>
            <div className="mb-4">
              <label style={labelStyle}>Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com" className="w-full outline-none transition-all"
                style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
            </div>
            <PrimaryButton loading={loading} loadingLabel="Sending...">Send code</PrimaryButton>
          </form>
        )}

        {/* ─── STEP 1b: this email uses Google sign-in ─── */}
        {step === 1 && googleAccount && (
          <div>
            <div className="mb-5 flex items-start gap-2.5" style={{
              padding: '12px 14px', borderRadius: 9, background: C.bg2,
              border: `1px solid ${C.border}`, fontSize: 13, color: C.text2, lineHeight: 1.55,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.text3} strokeWidth="1.8" className="shrink-0" style={{ marginTop: 1 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <span><strong style={{ color: C.text }}>{email}</strong> signs in with Google, so there&rsquo;s no password to reset. Use the button below to continue.</span>
            </div>
            <Link href="/login" style={{ textDecoration: 'none' }}>
              <div className="w-full flex items-center justify-center gap-2.5" style={{
                height: 42, borderRadius: 9, background: C.surface,
                border: `1px solid ${C.border2}`, fontFamily: C.sans,
                fontSize: 14, fontWeight: 500, color: C.text, cursor: 'pointer',
              }}>
                <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Continue with Google
              </div>
            </Link>
            <div className="text-center mt-4" style={{ fontSize: 13, color: C.text3 }}>
              Wrong account?{' '}
              <button type="button" onClick={() => { setGoogleAccount(false); setEmail('') }}
                style={{ color: C.red, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, padding: 0 }}>
                Try another email
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 2: code ────────────────────────────── */}
        {step === 2 && (
          <form onSubmit={handleVerifyCode}>
            <div className="mb-4">
              <label style={labelStyle}>Verification code</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full outline-none transition-all"
                style={{
                  ...inputStyle,
                  fontFamily: C.mono, fontSize: 18, letterSpacing: '0.3em', textAlign: 'center',
                }}
                onFocus={onFocus} onBlur={onBlur}
              />
            </div>

            <PrimaryButton loading={loading} disabled={code.length !== 6} loadingLabel="Verifying...">
              Verify code
            </PrimaryButton>

            <div className="text-center mt-4" style={{ fontSize: 13, color: C.text3 }}>
              Didn&apos;t get it?{' '}
              <button type="button" onClick={handleSendCode}
                style={{ color: C.red, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, padding: 0 }}>
                Resend
              </button>
            </div>
          </form>
        )}

        {/* ─── STEP 3: new password ────────────────────── */}
        {step === 3 && (
          <form onSubmit={handleReset}>
            <div className="mb-4">
              <label style={labelStyle}>New password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} required value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full outline-none transition-all"
                  style={{ ...inputStyle, padding: '0 40px 0 14px' }}
                  onFocus={onFocus} onBlur={onBlur}
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

            <div className="mb-4">
              <label style={labelStyle}>Confirm new password</label>
              <input type={showPassword ? 'text' : 'password'} required value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full outline-none transition-all"
                style={inputStyle}
                onFocus={onFocus} onBlur={onBlur}
              />
            </div>

            <PrimaryButton loading={loading} loadingLabel="Updating...">Reset password</PrimaryButton>
          </form>
        )}

        {/* ─── STEP 4: done ────────────────────────────── */}
        {step === 4 && (
          <div className="flex justify-center" style={{ padding: '8px 0 4px' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: C.greenBg, border: `1px solid ${C.greenDim}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
        )}

        {/* Back to login link */}
        {step !== 4 && (
          <div className="text-center mt-6" style={{ fontSize: 13, color: C.text3 }}>
            Remembered it?{' '}
            <Link href="/login" style={{ color: C.red, textDecoration: 'none', fontWeight: 500 }}>
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
