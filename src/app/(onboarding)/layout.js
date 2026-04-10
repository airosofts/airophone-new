'use client'

import { useRouter } from 'next/navigation'

export default function OnboardingLayout({ children }) {
  const router = useRouter()

  const handleLogout = () => {
    localStorage.removeItem('user_session')
    router.push('/login')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F7F6F3', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      {/* Top bar */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 32px', borderBottom: '1px solid #E3E1DB', background: '#FFFFFF',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="26" height="26" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="78" height="78" rx="17" stroke="#D63B1F" strokeWidth="2.5"/>
            <path d="M22 58L40 22L58 58" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M29 45H51" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round"/>
            <circle cx="57" cy="21" r="5" fill="#D63B1F"/>
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210' }}>AiroPhone</span>
        </div>
        <button onClick={handleLogout} style={{
          fontSize: 13, color: '#9B9890', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        }}>
          Log out
        </button>
      </div>
      {children}
    </div>
  )
}
