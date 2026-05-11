// components/Sidebar.jsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
      <path d="M5.99805 8.28223C6.30871 7.8939 6.78015 7.91224 7.08594 8.07715L7.20605 8.15625L7.26367 8.20703C7.31678 8.25917 7.36011 8.31812 7.39453 8.38086C7.63506 8.74097 7.53729 9.20196 7.27734 9.46191C7.25791 9.48133 7.23726 9.49944 7.21582 9.5166C6.89023 9.77707 6.38593 9.78403 6.05469 9.45312C5.76853 9.16697 5.72608 8.73269 5.92188 8.40137C5.94382 8.3598 5.96834 8.31936 5.99805 8.28223ZM9.33301 8.28223C9.64367 7.89396 10.1151 7.91225 10.4209 8.07715L10.541 8.15625L10.5986 8.20703C10.6517 8.25915 10.6951 8.31814 10.7295 8.38086C10.97 8.74093 10.8722 9.20197 10.6123 9.46191C10.5929 9.4813 10.5722 9.49945 10.5508 9.5166C10.2252 9.77705 9.72089 9.78397 9.38965 9.45312C9.10349 9.16697 9.06104 8.73269 9.25684 8.40137C9.27877 8.35981 9.30332 8.31935 9.33301 8.28223ZM12.665 8.28223C12.9757 7.89405 13.4472 7.91226 13.7529 8.07715L13.873 8.15625L13.9307 8.20703C13.9837 8.25913 14.0271 8.31818 14.0615 8.38086C14.3019 8.74088 14.2041 9.20197 13.9443 9.46191C13.925 9.48127 13.9042 9.49948 13.8828 9.5166C13.5573 9.77703 13.0529 9.78387 12.7217 9.45312C12.4355 9.16697 12.3931 8.73269 12.5889 8.40137C12.6108 8.35984 12.6354 8.31932 12.665 8.28223ZM15 1.875C16.6954 1.875 18.125 3.18821 18.125 4.875V12.792C18.1248 14.4786 16.6953 15.792 15 15.792H13.958V18.333C13.958 18.5704 13.824 18.788 13.6113 18.8936C13.3986 18.9991 13.1441 18.9747 12.9551 18.8311L8.95605 15.792H5C3.30469 15.792 1.87518 14.4786 1.875 12.792V4.875C1.875 3.18821 3.30458 1.875 5 1.875H15ZM5 3.125C3.93375 3.125 3.125 3.93821 3.125 4.875V12.792C3.12519 13.7286 3.93387 14.542 5 14.542H9.16699C9.30347 14.5421 9.43626 14.5864 9.54492 14.6689L12.708 17.0723V15.167C12.708 14.8219 12.988 14.5422 13.333 14.542H15C16.0661 14.542 16.8748 13.7286 16.875 12.792V4.875C16.875 3.93821 16.0663 3.125 15 3.125H5Z"/>
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
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
      <path d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/>
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
  const [unreadCounts, setUnreadCounts] = useState({})
  const unreadChannelRef = useRef(null)
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

  const fetchUnreadCounts = useCallback(async () => {
    try {
      const res = await apiGet('/api/conversations/unread-counts')
      const data = await res.json()
      if (data.counts) setUnreadCounts(data.counts)
    } catch (e) {}
  }, [])

  useEffect(() => {
    if (!user?.workspaceId) return
    fetchUnreadCounts()

    // Poll as a fallback in case realtime subscriptions miss events
    // (Supabase realtime on the messages table can be unreliable across networks).
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchUnreadCounts()
    }, 8000)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchUnreadCounts()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(pollInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchUnreadCounts, user?.workspaceId])

  // Subscribe to conversations UPDATE — webhook sets last_message_at on every inbound message.
  // Refetch unread counts so badges update in real-time alongside the notification sound.
  // Also listen for inbox-unread-update events (dispatched by inbox page when conversations
  // state changes, e.g. after mark-as-read) to update counts immediately.
  useEffect(() => {
    const workspaceId = user?.workspaceId
    if (!workspaceId) return

    if (unreadChannelRef.current) supabase.removeChannel(unreadChannelRef.current)

    unreadChannelRef.current = supabase
      .channel(`sidebar_unread_${workspaceId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `workspace_id=eq.${workspaceId}` },
        () => fetchUnreadCounts()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => fetchUnreadCounts()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        () => fetchUnreadCounts()
      )
      .subscribe()

    // Inbox dispatches this event whenever its conversations state changes.
    // Just refetch from the API so badges across ALL phones stay in sync
    // (don't trust the dispatched per-phone count — it can disagree with the
    // API and cause badges to flicker/disappear when polling replaces state).
    const handleInboxUpdate = () => fetchUnreadCounts()
    window.addEventListener('inbox-unread-update', handleInboxUpdate)

    return () => {
      if (unreadChannelRef.current) {
        supabase.removeChannel(unreadChannelRef.current)
        unreadChannelRef.current = null
      }
      window.removeEventListener('inbox-unread-update', handleInboxUpdate)
    }
  }, [user?.workspaceId, fetchUnreadCounts])

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
                {(unreadCounts[phone.phoneNumber] || 0) > 0 && (
                  <span style={{
                    minWidth: 20, height: 20, borderRadius: 10,
                    background: '#D63B1F', color: '#fff',
                    fontSize: 11, fontWeight: 600, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 6px', lineHeight: 1,
                    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  }}>
                    {unreadCounts[phone.phoneNumber] > 99 ? '99+' : unreadCounts[phone.phoneNumber]}
                  </span>
                )}
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
