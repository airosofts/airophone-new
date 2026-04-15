'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F7F6F3', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <p style={{ fontSize: 14, color: '#5C5A55' }}>Loading...</p>
      </div>
    }>
      <AuthCallbackInner />
    </Suspense>
  )
}

function AuthCallbackInner() {
  const [status, setStatus] = useState('Processing your sign in...')
  const [error, setError] = useState(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const code = searchParams.get('code')

    if (!code) {
      setError('No authorization code found. Please try signing in again.')
      return
    }

    exchangeCode(code)
  }, [searchParams])

  async function exchangeCode(code) {
    try {
      setStatus('Setting up your account...')

      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: `${window.location.origin}/auth/callback` }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to complete sign in.')
        return
      }

      localStorage.setItem('user_session', JSON.stringify(data.session))
      setStatus('Redirecting...')
      // New users go to onboarding, existing users go to inbox
      router.push(data.isNewUser ? '/onboarding' : '/inbox')
    } catch (err) {
      console.error('Callback error:', err)
      setError('Something went wrong. Please try signing in again.')
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F7F6F3', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        {error ? (
          <>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'rgba(214,59,31,0.07)', border: '1px solid rgba(214,59,31,0.14)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D63B1F" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#131210', marginBottom: 8 }}>Sign in failed</p>
            <p style={{ fontSize: 13, color: '#5C5A55', lineHeight: 1.6, marginBottom: 24 }}>{error}</p>
            <a href="/login" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 20px', borderRadius: 9,
              background: '#D63B1F', color: '#fff',
              fontSize: 13, fontWeight: 500, textDecoration: 'none',
            }}>
              Back to login
            </a>
          </>
        ) : (
          <>
            <div style={{ position: 'relative', width: 48, height: 48, margin: '0 auto 20px' }}>
              <div style={{ position: 'absolute', inset: 0, border: '3px solid rgba(214,59,31,0.15)', borderRadius: '50%' }} />
              <div style={{ position: 'absolute', inset: 0, border: '3px solid #D63B1F', borderTop: '3px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 500, color: '#131210' }}>{status}</p>
          </>
        )}
      </div>
    </div>
  )
}
