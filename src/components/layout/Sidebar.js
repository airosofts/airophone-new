// components/Sidebar.jsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { logout } from '@/lib/auth'
import { apiGet, apiPost } from '@/lib/api-client'
import { validateAndUpgradeSession } from '@/lib/session-validator'
import NotificationPanel from './NotificationPanel'
import { supabase } from '@/lib/supabase'
import Avatar from '@/components/ui/avatar'
import { usePresence } from '@/hooks/usePresence'

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
  '/automations': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/>
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
  '/followup-logs': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
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

/* ── Compact icons for the account dropdown ── */
const MENU_ICONS = {
  user: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  hash: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>,
  card: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  gear: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  gift: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>,
  help: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  logout: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>,
}

export default function Sidebar({ user, currentPath, onClose, onNotificationNavigate }) {
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const [unreadCounts, setUnreadCounts] = useState({})
  const [members, setMembers] = useState([])   // team roster (names/avatars)
  const { isOnline: presenceOnline } = usePresence(user?.workspaceId)   // live online/offline
  const [dragId, setDragId] = useState(null)
  const [sidebarWidth, setSidebarWidth] = useState(216)   // resizable; persists per browser
  const unreadChannelRef = useRef(null)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const channelRef = useRef(null)

  // Workspace/account dropdown (logout lives in here, not in the always-visible
  // footer — moving it behind a click prevents accidental sign-outs).
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Per-line "…" menu (hover a number → dots → Copy phone number).
  const [phoneMenuId, setPhoneMenuId] = useState(null)
  const [phoneCopied, setPhoneCopied] = useState(false)

  useEffect(() => {
    if (!phoneMenuId) return
    const close = () => { setPhoneMenuId(null); setPhoneCopied(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [phoneMenuId])

  const copyPhone = async (number) => {
    try {
      await navigator.clipboard.writeText(number || '')
      setPhoneCopied(true)
      setTimeout(() => { setPhoneMenuId(null); setPhoneCopied(false) }, 900)
    } catch { setPhoneMenuId(null) }
  }

  // Get the currently selected phone number from URL
  const selectedPhoneNumber = searchParams?.get('from')

  // Close the account dropdown on outside-click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

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

  // Resizable sidebar — drag the right edge.
  useEffect(() => {
    const w = Number(localStorage.getItem('sidebar.width'))
    if (w) setSidebarWidth(w)
  }, [])
  useEffect(() => { localStorage.setItem('sidebar.width', String(sidebarWidth)) }, [sidebarWidth])

  // ── Presence ──────────────────────────────────────────────────────────────
  // Heartbeat: tell the server we're active every 45s (and immediately, and
  // whenever the tab regains focus). "Online" is last_seen within 2 minutes.
  useEffect(() => {
    if (!user?.workspaceId) return
    let stopped = false
    const beat = () => { if (!document.hidden) apiPost('/api/presence/heartbeat', {}).catch(() => {}) }
    beat()
    const handle = setInterval(() => { if (!stopped) beat() }, 45000)
    const onVis = () => { if (!document.hidden) beat() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stopped = true; clearInterval(handle); document.removeEventListener('visibilitychange', onVis) }
  }, [user?.workspaceId])

  // Team roster (names/avatars). Presence is handled live by usePresence, so this
  // only needs an occasional refresh to catch members added/removed.
  useEffect(() => {
    if (!user?.workspaceId) return
    let cancelled = false
    const load = () => apiGet('/api/workspace/members')
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d?.members)) setMembers(d.members) })
      .catch(() => {})
    load()
    const handle = setInterval(load, 120000)
    return () => { cancelled = true; clearInterval(handle) }
  }, [user?.workspaceId])
  const startSidebarResize = (e) => {
    e.preventDefault()
    const startX = e.clientX, startW = sidebarWidth
    const onMove = (ev) => setSidebarWidth(Math.min(380, Math.max(180, startW + (ev.clientX - startX))))
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Drag to reorder. The list arrives already sorted (server sort_order); on
  // drop we optimistically reorder and persist to the DB so it sticks across
  // devices and for everyone in the workspace.
  const handlePhoneDrop = (targetId) => {
    const srcId = dragId
    setDragId(null)
    if (srcId == null || String(srcId) === String(targetId)) return
    setPhoneNumbers(prev => {
      const arr = [...prev]
      const from = arr.findIndex(p => String(p.id) === String(srcId))
      const to = arr.findIndex(p => String(p.id) === String(targetId))
      if (from < 0 || to < 0) return prev
      arr.splice(to, 0, arr.splice(from, 1)[0])
      apiPost('/api/phone-numbers/reorder', { order: arr.map(p => p.id) }).catch(() => {})
      return arr
    })
  }

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
    { name: 'Automations', href: '/automations' },
    { name: 'Follow-up Logs', href: '/followup-logs' },
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

  // Navigate from a dropdown item, then close the menu (and the mobile drawer).
  const goTo = (href) => {
    setMenuOpen(false)
    if (href.startsWith('mailto:')) { window.location.href = href; return }
    router.push(href)
    if (onClose) onClose()
  }

  // Account dropdown items. Grouped; render order inserts a divider between
  // groups. Logout is its own trailing group so it sits visually apart.
  const MENU_GROUPS = [
    [
      { label: 'Your profile',      href: '/settings?section=profile',   icon: 'user' },
      { label: 'Phone numbers',     href: '/settings?section=numbers',   icon: 'hash' },
      { label: 'Plan & billing',    href: '/billing',                    icon: 'card' },
      { label: 'Workspace settings', href: '/settings?section=members',  icon: 'gear' },
    ],
    [
      { label: 'Refer & earn',      href: '/settings?section=referrals', icon: 'gift' },
      { label: 'Help & support',    href: 'mailto:support@airophone.com', icon: 'help' },
    ],
  ]

  return (
    <div
      className="h-screen flex flex-col z-40"
      style={{
        width: sidebarWidth,
        flexShrink: 0,
        position: 'relative',
        background: '#FFFFFF',
        borderRight: '1px solid #E3E1DB',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      {/* Drag the right edge to resize the sidebar (desktop only) */}
      <div onMouseDown={startSidebarResize} title="Drag to resize" className="hidden lg:block group"
        style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 50 }}>
        <div className="h-full mx-auto group-hover:bg-[#D63B1F]/40 transition-colors" style={{ width: 2 }} />
      </div>
      {/* ── Header: workspace name = account dropdown trigger ── */}
      <div ref={menuRef} style={{ position: 'relative', borderBottom: '1px solid #E3E1DB' }}>
        <div style={{
          height: 56, display: 'flex', alignItems: 'center',
          padding: '0 10px 0 10px', gap: 6,
        }}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9,
              padding: '6px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: menuOpen ? '#F7F6F3' : 'transparent',
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => { if (!menuOpen) e.currentTarget.style.background = '#F7F6F3' }}
            onMouseLeave={(e) => { if (!menuOpen) e.currentTarget.style.background = 'transparent' }}
          >
            {/* Workspace avatar — initial of the workspace name */}
            <div style={{
              width: 26, height: 26, borderRadius: 7, flexShrink: 0,
              background: '#D63B1F', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, letterSpacing: '-0.02em',
            }}>
              {(user?.workspaceName || 'A').charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', color: '#131210', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.workspaceName || 'AiroPhone'}
              </div>
              <div style={{ fontSize: '9.5px', color: '#9B9890', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name || user?.email}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <NotificationPanel onNavigateToConversation={onNotificationNavigate} />
          {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 rounded" style={{ color: '#9B9890' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Dropdown */}
        {menuOpen && (
          <div style={{
            position: 'absolute', top: 52, left: 8, right: 8, zIndex: 60,
            background: '#fff', border: '1px solid #E3E1DB', borderRadius: 12,
            boxShadow: '0 12px 32px -12px rgba(19,18,16,0.28), 0 2px 8px -4px rgba(19,18,16,0.12)',
            padding: 6, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          }}>
            {/* Identity block */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px 10px' }}>
              {user?.profile_photo_url ? (
                <img src={user.profile_photo_url} alt={user.name} style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: 'rgba(214,59,31,0.14)', color: '#D63B1F',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600,
                }}>{user?.name?.charAt(0)?.toUpperCase()}</div>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#131210', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
                <div style={{ fontSize: '10px', color: '#9B9890', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
              </div>
            </div>

            {MENU_GROUPS.map((group, gi) => (
              <div key={gi} style={{ borderTop: '1px solid #F0EEE9', padding: '4px 0' }}>
                {group.map((it) => (
                  <button
                    key={it.label}
                    onClick={() => goTo(it.href)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                      background: 'transparent', textAlign: 'left',
                      fontSize: 12.5, color: '#131210',
                      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ width: 15, height: 15, flexShrink: 0, color: '#9B9890', display: 'flex' }}>{MENU_ICONS[it.icon]}</span>
                    <span>{it.label}</span>
                  </button>
                ))}
              </div>
            ))}

            {/* Logout — separated, danger-tinted */}
            <div style={{ borderTop: '1px solid #F0EEE9', padding: '4px 0 0' }}>
              <button
                onClick={() => { setMenuOpen(false); handleLogout() }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: 'transparent', textAlign: 'left',
                  fontSize: 12.5, fontWeight: 500, color: '#D63B1F',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(214,59,31,0.07)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ width: 15, height: 15, flexShrink: 0, display: 'flex' }}>{MENU_ICONS.logout}</span>
                <span>Log out</span>
              </button>
            </div>
          </div>
        )}
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
            const isDragging = String(dragId) === String(phone.id)
            return (
              <button
                key={phone.id}
                className="group"
                draggable
                onDragStart={(e) => { setDragId(phone.id); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                onDrop={(e) => { e.preventDefault(); handlePhoneDrop(phone.id) }}
                onDragEnd={() => setDragId(null)}
                onClick={() => handlePhoneNumberClick(phone.phoneNumber)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 16px', border: 'none', position: 'relative',
                  cursor: isDragging ? 'grabbing' : 'pointer',
                  background: isSelected ? '#F7F6F3' : 'transparent',
                  opacity: isDragging ? 0.45 : 1,
                  textAlign: 'left', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#F7F6F3' }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                {/* Drag grip — only visible on hover; signals the row is reorderable */}
                <svg width="8" height="14" viewBox="0 0 8 14" fill="#C8C5BD" aria-hidden
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ flexShrink: 0, marginLeft: -2, cursor: 'grab' }}>
                  <circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/>
                  <circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/>
                  <circle cx="2" cy="12" r="1"/><circle cx="6" cy="12" r="1"/>
                </svg>
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
                {/* Hover "…" menu — Copy phone number (span, not button: the
                    row itself is a <button> and buttons can't nest). */}
                <span
                  role="button"
                  title="More"
                  onClick={(e) => { e.stopPropagation(); setPhoneCopied(false); setPhoneMenuId(phoneMenuId === phone.id ? null : phone.id) }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`${phoneMenuId === phone.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
                  style={{ flexShrink: 0, padding: '2px 4px', borderRadius: 6, color: '#9B9890' }}
                >
                  <i className="fas fa-ellipsis-h" style={{ fontSize: 11 }} />
                </span>
                {phoneMenuId === phone.id && (
                  <span
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute', right: 10, top: '100%', zIndex: 60,
                      background: '#fff', border: '1px solid #E3E1DB', borderRadius: 10,
                      boxShadow: '0 8px 24px rgba(19,18,16,0.10)', padding: 4, minWidth: 180,
                      display: 'block',
                    }}
                  >
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); copyPhone(phone.phoneNumber) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 10px', borderRadius: 7, fontSize: 12.5,
                        color: phoneCopied ? '#1F8C4A' : '#131210', whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <i className={`fas ${phoneCopied ? 'fa-check' : 'fa-copy'}`} style={{ fontSize: 11, width: 14 }} />
                      {phoneCopied ? 'Copied!' : 'Copy phone number'}
                    </span>
                  </span>
                )}
              </button>
            )
          })}
          {phoneNumbers.length === 0 && !loading && (
            <p style={{ padding: '5px 16px', fontSize: '11.5px', color: '#9B9890' }}>No phone numbers yet</p>
          )}
        </div>

        {/* My Team — roster with live presence (green = active now) */}
        {members.length > 0 && (
          <>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9, color: '#9B9890',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '16px 16px 5px',
            }}>
              My Team
            </div>
            <div>
              {[...members]
                .sort((a, b) => {
                  if (a.userId === user?.userId) return -1
                  if (b.userId === user?.userId) return 1
                  const ao = presenceOnline(a.userId, a.lastSeen), bo = presenceOnline(b.userId, b.lastSeen)
                  if (ao !== bo) return ao ? -1 : 1   // online first
                  return (a.name || '').localeCompare(b.name || '')
                })
                .map((m) => {
                  const isYou = m.userId === user?.userId
                  const online = presenceOnline(m.userId, m.lastSeen)
                  return (
                    <div
                      key={m.userId || m.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 16px' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <Avatar name={m.name} seed={m.name} photoUrl={m.avatar} size={22} online={online} title={m.name} />
                      <div style={{
                        flex: 1, minWidth: 0, fontSize: '11.5px', color: '#5C5A55',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                      }}>
                        {m.name}{isYou && <span style={{ color: '#9B9890' }}> · You</span>}
                      </div>
                    </div>
                  )
                })}
            </div>
          </>
        )}
      </nav>
    </div>
  )
}
