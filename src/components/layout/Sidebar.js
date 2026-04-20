// components/Sidebar.jsx
'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { logout } from '@/lib/auth'
import { apiGet } from '@/lib/api-client'
import { validateAndUpgradeSession } from '@/lib/session-validator'
import NotificationPanel from './NotificationPanel'
import { supabase } from '@/lib/supabase'

/* ── Brand SVG icons for nav (matching v2.2 design) ── */
const NAV_ICONS = {
  '/inbox': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  ),
  '/contacts': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  '/campaigns': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  ),
  '/scenarios': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
    </svg>
  ),
  '/call-history': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.66A2 2 0 012 3H5a2 2 0 012 1.72c.12.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L6.09 10.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0122 17v-.08z"/>
    </svg>
  ),
  '/billing': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  '/analytics': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  '/settings': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/>
    </svg>
  ),
}

export default function Sidebar({ user, currentPath, onClose, onNotificationNavigate }) {
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const channelRef = useRef(null)

  // Get the currently selected phone number from URL
  const selectedPhoneNumber = searchParams?.get('from')

  useEffect(() => {
    const init = async () => {
      await validateAndUpgradeSession()
      fetchPhoneNumbers()
    }
    init()
  }, [])

  // Subscribe to phone_number updates so campaign_status changes reflect immediately
  useEffect(() => {
    const workspaceId = user?.workspaceId
    if (!workspaceId) return

    if (channelRef.current) supabase.removeChannel(channelRef.current)

    channelRef.current = supabase
      .channel(`sidebar_phone_numbers_${workspaceId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'phone_numbers', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          setPhoneNumbers(current => current.map(p =>
            p.id === payload.new.id
              ? { ...p, campaign_status: payload.new.campaign_status, status: payload.new.status }
              : p
          ))
        }
      )
      .subscribe()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [user?.workspaceId])

  const fetchPhoneNumbers = async () => {
    try {
      const response = await apiGet('/api/phone-numbers')
      const data = await response.json()
      if (data.success) {
        setPhoneNumbers(data.phoneNumbers || [])
      } else {
        console.error('Failed to fetch phone numbers:', data.error)
      }
    } catch (error) {
      console.error('Error fetching phone numbers:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits

    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }

  const navigation = [
    { name: 'Inbox', href: '/inbox' },
    { name: 'Contacts', href: '/contacts' },
    { name: 'Campaigns', href: '/campaigns' },
    { name: 'AI Scenarios', href: '/scenarios' },
    { name: 'Analytics', href: '/analytics' },
    { name: 'Billing', href: '/billing' },
    { name: 'Settings', href: '/settings' },
  ]

  const handleLogout = () => {
    logout()
  }

  const handlePhoneNumberClick = (phoneNumber) => {
    router.push(`/inbox?from=${encodeURIComponent(phoneNumber)}`)
  }

  return (
    <div
      className="h-screen flex flex-col z-40"
      style={{
        width: 216,
        flexShrink: 0,
        background: '#FFFFFF',
        borderRight: '1px solid #E3E1DB',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      {/* ── Header ── */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center',
        padding: '0 16px', borderBottom: '1px solid #E3E1DB', gap: 9,
      }}>
        <div style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="26" height="26" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="78" height="78" rx="17" stroke="#D63B1F" strokeWidth="2.5"/>
            <path d="M22 58L40 22L58 58" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M29 45H51" stroke="#D63B1F" strokeWidth="4.5" strokeLinecap="round"/>
            <circle cx="57" cy="21" r="5" fill="#D63B1F"/>
          </svg>
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210', flex: 1 }}>
          AiroPhone
        </span>
        <div className="flex items-center gap-1">
          <NotificationPanel onNavigateToConversation={onNotificationNavigate} />
          {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 rounded" style={{ color: '#9B9890' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Navigation ── */}
      <nav style={{ padding: '8px 0', flex: 1, overflowY: 'auto' }}>
        {/* Main nav items */}
        <div>
          {navigation.map((item) => {
            const isActive = pathname?.startsWith(item.href)
            return (
              <Link
                key={item.name}
                href={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '8px 16px', fontSize: 13,
                  color: isActive ? '#131210' : '#5C5A55',
                  fontWeight: isActive ? 500 : 400,
                  background: isActive ? 'rgba(214,59,31,0.07)' : 'transparent',
                  textDecoration: 'none', position: 'relative',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = '#F7F6F3'; e.currentTarget.style.color = '#131210' } }}
                onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#5C5A55' } }}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <div style={{
                    position: 'absolute', left: 0, top: 6, bottom: 6,
                    width: 3, background: '#D63B1F', borderRadius: '0 2px 2px 0',
                  }} />
                )}
                <span style={{ width: 14, height: 14, flexShrink: 0, color: isActive ? '#131210' : '#9B9890' }}>
                  {NAV_ICONS[item.href]}
                </span>
                <span>{item.name}</span>
              </Link>
            )
          })}
        </div>

        {/* Phone Numbers Section */}
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9, color: '#9B9890',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          padding: '14px 16px 5px',
        }}>
          Phone Numbers
        </div>
        <div>
          {phoneNumbers.map((phone) => {
            const isSelected = selectedPhoneNumber === phone.phoneNumber
            return (
              <button
                key={phone.id}
                onClick={() => handlePhoneNumberClick(phone.phoneNumber)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 16px', border: 'none', cursor: 'pointer',
                  background: isSelected ? '#F7F6F3' : 'transparent',
                  textAlign: 'left', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#F7F6F3' }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: phone.campaign_status === 'rejected' ? '#ef4444'
                    : phone.campaign_status === 'pending' ? '#f59e0b'
                    : (phone.status === 'active' || phone.status === 'purchased') ? '#22c55e'
                    : '#f59e0b',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11.5px', color: '#5C5A55', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {phone.custom_name || formatPhoneNumber(phone.phoneNumber)}
                  </div>
                  {phone.custom_name && (
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '9.5px', color: '#9B9890',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {formatPhoneNumber(phone.phoneNumber)}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
          {phoneNumbers.length === 0 && !loading && (
            <p style={{ padding: '5px 16px', fontSize: '11.5px', color: '#9B9890' }}>No phone numbers yet</p>
          )}
        </div>
      </nav>

      {/* ── User Profile ── */}
      <div
        className="group"
        style={{
          padding: '12px 16px', borderTop: '1px solid #E3E1DB',
          display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer',
        }}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {user?.profile_photo_url ? (
            <img src={user.profile_photo_url} alt={user.name} style={{ width: 26, height: 26, borderRadius: '50%' }} />
          ) : (
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'rgba(214,59,31,0.14)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 600, color: '#D63B1F',
            }}>
              {user?.name?.charAt(0)?.toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#131210', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.name}
          </div>
          <div style={{
            fontSize: '9.5px', color: '#9B9890',
            fontFamily: "'JetBrains Mono', monospace",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {user?.email}
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ padding: 2, color: '#9B9890', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}
          title="Sign out"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
