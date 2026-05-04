'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { apiPost, fetchWithWorkspace } from '@/lib/api-client'
import { validateAndUpgradeSession } from '@/lib/session-validator'
import ConversationList from '@/components/inbox/ConversationList'
import ChatWindow from '@/components/inbox/ChatWindow'
import ContactPanel from '@/components/inbox/ContactPanel'
import NewConversationView from '@/components/inbox/NewConversationView'
import FilterTabs from '@/components/inbox/FilterTabs'
import CallInterface from '@/components/calling/CallInterface'
import { useRealtimeConversations, useRealtimeMessages, usePhoneNumbers } from '@/hooks/useRealtime'
import { useWebRTCCall } from '@/hooks/useWebRTCCall'
import SkeletonLoader from '@/components/ui/skeleton-loader'

export default function InboxPage() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [inboxTab, setInboxTab] = useState('chats') // 'chats' | 'calls'
  const [calls, setCalls] = useState([])
  const [callsLoading, setCallsLoading] = useState(false)
  const [callFilter, setCallFilter] = useState('all') // 'all' | 'missed' | 'voicemail'
  const [showDialer, setShowDialer] = useState(false)
  const [dialerQuery, setDialerQuery] = useState('')
  const [dialerContacts, setDialerContacts] = useState([])
  const [dialerLoading, setDialerLoading] = useState(false)
  const dialerRef = useRef(null)

  const [audioUnlocked, setAudioUnlocked] = useState(() => {
    if (typeof window === 'undefined') return false
    if (localStorage.getItem('airo_audio_unlocked') === '1') return true
    return window.__airoCtx?.state === 'running'
  })
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [showBlockedHelp, setShowBlockedHelp] = useState(false)
  const [notifPermission, setNotifPermission] = useState(() => {
    if (typeof window === 'undefined') return 'default'
    return 'Notification' in window ? Notification.permission : 'granted'
  })

  // Initialize workspaceId synchronously from localStorage so usePhoneNumbers
  // and useRealtimeConversations get the correct value on the very first render.
  // If we set it inside useEffect (async), the hooks start with undefined and
  // never set up their Supabase Realtime subscriptions properly.
  const [workspaceId, setWorkspaceId] = useState(() => {
    if (typeof window === 'undefined') return null
    try {
      const session = localStorage.getItem('user_session')
      return session ? JSON.parse(session).workspaceId || null : null
    } catch { return null }
  })


  const { phoneNumbers, setPhoneNumbers } = usePhoneNumbers(workspaceId)

  const [selectedConversation, setSelectedConversation] = useState(null)
  const [isCreatingNewConversation, setIsCreatingNewConversation] = useState(false)

  const [filter, setFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [mobileView, setMobileView] = useState('list') // 'list' | 'chat' | 'contact'
  const [assignScenarioModal, setAssignScenarioModal] = useState(null) // { conversationId, phoneNumber }
  const [highlightNoteId, setHighlightNoteId] = useState(null)

  const searchParams = useSearchParams()
  const router = useRouter()
  const audioRef = useRef(null)

  const callHook = useWebRTCCall()

  const handleAudioUnlock = () => {
    localStorage.setItem('airo_audio_unlocked', '1')
    setAudioUnlocked(true)
  }

  // Dialer: search contacts as user types
  useEffect(() => {
    if (!dialerQuery.trim()) { setDialerContacts([]); return }
    const t = setTimeout(async () => {
      setDialerLoading(true)
      try {
        const session = localStorage.getItem('user_session')
        const s = session ? JSON.parse(session) : {}
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(dialerQuery)}`, {
          headers: { 'x-user-id': s.userId || '', 'x-workspace-id': s.workspaceId || '' }
        })
        const data = await res.json()
        setDialerContacts(data.contacts || [])
      } catch (_) { setDialerContacts([]) }
      finally { setDialerLoading(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [dialerQuery])

  // Close dialer on outside click
  useEffect(() => {
    if (!showDialer) return
    const handler = (e) => { if (dialerRef.current && !dialerRef.current.contains(e.target)) setShowDialer(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDialer])

  // Fetch call history when calls tab is active
  useEffect(() => {
    if (inboxTab !== 'calls') return
    const fetchCalls = async () => {
      setCallsLoading(true)
      try {
        const res = await fetch(`/api/call-history?filter=${callFilter}&limit=50`)
        const data = await res.json()
        if (data.success) setCalls(data.calls || [])
      } catch (e) { console.error('Failed to fetch calls:', e) }
      finally { setCallsLoading(false) }
    }
    fetchCalls()
  }, [inboxTab, callFilter])

  const handleDialerCall = (phoneNumber) => {
    setShowDialer(false)
    setDialerQuery('')
    setDialerContacts([])
    if (callHook?.initiateCall && selectedPhoneNumber?.phoneNumber) {
      callHook.initiateCall(phoneNumber, selectedPhoneNumber.phoneNumber).catch(console.error)
    }
  }

  const fromParam = searchParams.get('from')
  const selectedPhoneNumber = phoneNumbers.find(p => p.phoneNumber === fromParam) || phoneNumbers[0] || null

  const { conversations, loading: conversationsLoading, refetch, setActiveConversation, deleteConversation, updateConversationOptimistic } = useRealtimeConversations(selectedPhoneNumber?.phoneNumber)
  const { messages: allMessages, loading: messagesLoading, addOptimisticMessage, replaceOptimisticMessage, removeOptimisticMessage } = useRealtimeMessages(selectedConversation?.id)

  // Only show messages that belong to the currently selected phone line
  const selectedLineNumber = selectedPhoneNumber?.phoneNumber
  const messages = selectedLineNumber
    ? allMessages.filter(item => {
        if (item.isOptimistic) return true
        // Call items linked to conversation are always relevant
        if (item._type === 'call') return true
        const normalize = (p) => p ? p.replace(/\D/g, '').replace(/^1/, '') : ''
        const line = normalize(selectedLineNumber)
        if (item.direction === 'outbound') return normalize(item.from_number) === line
        if (item.direction === 'inbound') return normalize(item.to_number) === line
        return true
      })
    : allMessages

  useEffect(() => {
    const initializeSession = async () => {
      // Validate and upgrade session if needed
      await validateAndUpgradeSession()

      const userSession = localStorage.getItem('user_session')
      if (userSession) {
        try {
          const userData = JSON.parse(userSession)
          setUser(userData)
          if (userData.workspaceId) setWorkspaceId(userData.workspaceId)
        } catch (error) {
          console.error('Error parsing user session:', error)
          const currentUser = getCurrentUser()
          setUser(currentUser)
          if (currentUser?.workspaceId) setWorkspaceId(currentUser.workspaceId)
        }
      } else {
        const currentUser = getCurrentUser()
        setUser(currentUser)
        if (currentUser?.workspaceId) setWorkspaceId(currentUser.workspaceId)
      }

      setLoading(false)
    }

    initializeSession()

    if (typeof Audio !== 'undefined') {
      const audio = new Audio('/message.mp3')
      audio.volume = 0.3
      audioRef.current = audio
    }
  }, [])

  useEffect(() => {
    if (phoneNumbers.length > 0 && callHook && !callHook.selectedCallerNumber) {
      const voiceCapableNumber = phoneNumbers.find(phone =>
        phone.capabilities?.includes('voice') || phone.capabilities?.includes('Voice')
      ) || phoneNumbers[0]

      if (voiceCapableNumber) {
        callHook.setSelectedCallerNumber(voiceCapableNumber.phoneNumber)
      }
    }
  }, [phoneNumbers, callHook])

  // Listen for notification-navigate events from sidebar / notifications page
  const pendingNavigationRef = useRef(null)

  // When conversations change, check if there's a pending navigation
  useEffect(() => {
    if (!pendingNavigationRef.current || !conversations.length) return
    const { conversationId, noteId } = pendingNavigationRef.current
    const conv = conversations.find(c => c.id === conversationId)
    if (conv) {
      pendingNavigationRef.current = null
      setActiveConversation(conv.id)
      setSelectedConversation(conv)
      setIsCreatingNewConversation(false)
      setMobileView('chat')
      refetch(false)
      if (noteId) {
        setHighlightNoteId(noteId)
        setTimeout(() => setHighlightNoteId(null), 4000)
        setTimeout(() => {
          const noteEl = document.getElementById(`note-${noteId}`)
          if (noteEl) noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 800)
      }
    }
  }, [conversations])

  useEffect(() => {
    const handleNotificationNavigate = (e) => {
      const { conversationId, noteId } = e.detail
      if (!conversationId) return
      // Store pending navigation — will be picked up when conversations load
      pendingNavigationRef.current = { conversationId, noteId }
      // Also try immediately in case conversations are already loaded
      const conv = conversations.find(c => c.id === conversationId)
      if (conv) {
        pendingNavigationRef.current = null
        setActiveConversation(conv.id)
        setSelectedConversation(conv)
        setIsCreatingNewConversation(false)
        setMobileView('chat')
        refetch(false)
        if (noteId) {
          setHighlightNoteId(noteId)
          setTimeout(() => setHighlightNoteId(null), 4000)
          setTimeout(() => {
            const noteEl = document.getElementById(`note-${noteId}`)
            if (noteEl) noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 800)
        }
      }
    }
    window.addEventListener('notification-navigate', handleNotificationNavigate)
    return () => window.removeEventListener('notification-navigate', handleNotificationNavigate)
  }, [conversations])

  // Play notification sound on new inbound messages (any conversation)
  const lastConvTimestampRef = useRef(null)
  useEffect(() => {
    if (!conversations.length) return
    // Find the most recent inbound lastMessage timestamp across all conversations
    let newestInbound = null
    for (const conv of conversations) {
      if (conv.lastMessage?.direction === 'inbound' && conv.lastMessage?.created_at) {
        if (!newestInbound || conv.lastMessage.created_at > newestInbound) {
          newestInbound = conv.lastMessage.created_at
        }
      }
    }
    if (!newestInbound) return
    // On first load, just record the timestamp without playing
    if (lastConvTimestampRef.current === null) {
      lastConvTimestampRef.current = newestInbound
      return
    }
    // Play sound if there's a newer inbound message
    if (newestInbound > lastConvTimestampRef.current) {
      lastConvTimestampRef.current = newestInbound
      if (audioRef.current) {
        audioRef.current.volume = 0.10
        audioRef.current.currentTime = 0
        audioRef.current.play().catch(err => console.warn('Sound play failed:', err.message))
      }
    }
  }, [conversations])

  const handleConversationSelect = (conversation) => {
    setActiveConversation(conversation.id)
    setSelectedConversation(conversation)
    setIsCreatingNewConversation(false)
    setMobileView('chat') // Switch to chat view on mobile
    // Refresh conversation names from contacts (in background, no reorder)
    refetch(false)
  }

  const handleMarkAsRead = async (conversationId) => {
    if (!user?.userId) return
    const conversation = conversations.find(c => c.id === conversationId)
    if (!conversation || conversation.unreadCount === 0) return

    try {
      updateConversationOptimistic(conversationId, { unreadCount: 0 })

      const response = await fetch('/api/conversations/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, userId: user.userId }),
      })

      if (!response.ok) {
        updateConversationOptimistic(conversationId, { unreadCount: conversation.unreadCount })
      }
    } catch (error) {
      console.error('Error marking messages as read:', error)
      updateConversationOptimistic(conversationId, { unreadCount: conversation?.unreadCount })
    }
  }

  const handleConversationDeselect = () => {
    setActiveConversation(null)
    setSelectedConversation(null)
    setIsCreatingNewConversation(false)
    setMobileView('list') // Go back to list on mobile
  }

  const handleNewConversationCreated = (conversation) => {
    setIsCreatingNewConversation(false)
    setSelectedConversation(conversation)
    setActiveConversation(conversation.id)
    setMobileView('chat')
    refetch()
  }

  const handleDeleteConversation = async (conversationId) => {
    const result = await deleteConversation(conversationId)
    if (result.success) {
      if (selectedConversation?.id === conversationId) {
        handleConversationDeselect()
      }
    }
  }

  const handleMarkAsUnread = async (conversationId) => {
    if (!user?.userId) return

    try {
      updateConversationOptimistic(conversationId, { unreadCount: 1 })

      const response = await fetch('/api/conversations/mark-unread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          userId: user.userId
        }),
      })

      if (!response.ok) {
        refetch()
      }
    } catch (error) {
      console.error('Error marking conversation as unread:', error)
      refetch()
    }
  }

  const handleMarkAsDone = async (conversationId) => {
    try {
      updateConversationOptimistic(conversationId, { status: 'closed' })

      const response = await fetch('/api/conversations/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          status: 'closed'
        }),
      })

      if (!response.ok) {
        refetch()
      }
    } catch (error) {
      console.error('Error marking conversation as done:', error)
      refetch()
    }
  }

  const handleMarkAsOpen = async (conversationId) => {
    try {
      updateConversationOptimistic(conversationId, { status: 'open' })

      const response = await fetch('/api/conversations/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          status: 'open'
        }),
      })

      if (!response.ok) {
        refetch()
      }
    } catch (error) {
      console.error('Error marking conversation as open:', error)
      refetch()
    }
  }

  const handleBlockContact = async (conversationId, phoneNumber) => {
    try {
      // Optimistically remove the conversation from the list
      if (selectedConversation?.id === conversationId) {
        handleConversationDeselect()
      }

      const response = await apiPost('/api/contacts/block', { phoneNumber })

      if (!response.ok) {
        console.error('Failed to block contact')
        refetch()
      } else {
        // Remove conversation from local state
        refetch(true)
      }
    } catch (error) {
      console.error('Error blocking contact:', error)
      refetch()
    }
  }

  const handlePinConversation = async (conversationId) => {
    try {
      const conversation = conversations.find(c => c.id === conversationId)
      const newPinnedState = !conversation?.pinned
      updateConversationOptimistic(conversationId, { pinned: newPinnedState })

      const response = await fetch('/api/conversations/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          pinned: newPinnedState
        }),
      })

      if (!response.ok) {
        refetch()
      } else {
        setTimeout(() => refetch(true), 100)
      }
    } catch (error) {
      console.error('Error pinning conversation:', error)
      refetch()
    }
  }

  const handleAssignScenario = (conversationId, phoneNumber) => {
    setAssignScenarioModal({ conversationId, phoneNumber })
  }

  const filteredConversations = conversations
    .filter(conv => {
      switch (filter) {
        case 'unread':
          return conv.unreadCount > 0
        case 'open':
          return conv.status !== 'closed'
        case 'done':
          return conv.status === 'closed'
        case 'unresponded':
          return conv.lastMessage?.direction === 'inbound'
        default:
          return true
      }
    })
    .filter(conv => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      const name = [conv.contact_first_name, conv.contact_last_name, conv.name].filter(Boolean).join(' ').toLowerCase()
      const phone = (conv.phone_number || '').toLowerCase()
      const preview = (conv.lastMessage?.body || '').toLowerCase()
      return name.includes(q) || phone.includes(q) || preview.includes(q)
    })
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return 0
    })

  // Always use the up-to-date conversation from the live array so optimistic
  // updates (pin, status, etc.) are reflected in the chat window immediately
  const activeConversation = selectedConversation
    ? conversations.find(c => c.id === selectedConversation.id) || selectedConversation
    : null

  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits

    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }

  if (loading) {
    return <SkeletonLoader type="dashboard" />
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: '#F7F6F3' }}>
        <div className="text-center">
          <div style={{ position: 'relative', width: 48, height: 48, margin: '0 auto 20px' }}>
            <div style={{ position: 'absolute', inset: 0, border: '3px solid rgba(214,59,31,0.15)', borderRadius: '50%' }} />
            <div style={{ position: 'absolute', inset: 0, border: '3px solid #D63B1F', borderTop: '3px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          </div>
          <p style={{ fontSize: 13, color: '#5C5A55' }}>Loading user session...</p>
        </div>
      </div>
    )
  }

  // Show pending banner for null (not yet assigned) OR pending status on US numbers
  const rawCampaignStatus = selectedPhoneNumber?.campaign_status
  const isUsNumber = selectedPhoneNumber?.phoneNumber?.startsWith('+1')
  const campaignStatus = (rawCampaignStatus === null && isUsNumber) ? 'pending' : rawCampaignStatus
  const approvalDismissed = !!selectedPhoneNumber?.approval_notified_at

  const dismissApproval = () => {
    if (!selectedPhoneNumber?.id) return
    // Optimistically hide the banner immediately
    setPhoneNumbers(current => current.map(p =>
      p.id === selectedPhoneNumber.id
        ? { ...p, approval_notified_at: new Date().toISOString() }
        : p
    ))
    // Persist to DB so it stays dismissed on any device
    fetch(`/api/phone-numbers/${selectedPhoneNumber.id}/dismiss-notification`, {
      method: 'POST',
      headers: { 'x-workspace-id': workspaceId },
    }).catch(() => {})
  }

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ background: '#FFFFFF' }}>
      {/* Notification + audio unlock banner */}
      {!bannerDismissed && (!audioUnlocked || notifPermission !== 'granted') && (
        <div
          style={{
            background: '#F7F6F3', color: '#131210', padding: '12px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, fontSize: 14,
            borderBottom: '1px solid #E3E1DB',
            position: 'relative',
          }}
        >
          <span
            onClick={async () => {
              handleAudioUnlock()
              if ('Notification' in window) {
                if (Notification.permission === 'default') {
                  const result = await Notification.requestPermission()
                  setNotifPermission(result)
                  if (result === 'granted') setBannerDismissed(true)
                  if (result === 'denied') setShowBlockedHelp(true)
                } else if (Notification.permission === 'denied') {
                  setShowBlockedHelp(true)
                }
              }
            }}
            style={{ fontWeight: 500, cursor: 'pointer' }}
          >
            Click to enable notifications for calls and messages.
          </span>
          <svg
            onClick={(e) => { e.stopPropagation(); handleAudioUnlock(); setBannerDismissed(true) }}
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="2"
            style={{ position: 'absolute', right: 20, cursor: 'pointer' }}
          >
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </div>
      )}

      {/* Enable notifications modal — shown when blocked */}
      {showBlockedHelp && (
        <div
          onClick={() => setShowBlockedHelp(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(19,18,16,0.3)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#FFFFFF', border: '1px solid #E3E1DB', borderRadius: 14,
              width: '100%', maxWidth: 480, overflow: 'hidden',
              boxShadow: '0 20px 56px rgba(19,18,16,0.12)',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '20px 24px', borderBottom: '1px solid #E3E1DB',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210' }}>
                Enable notifications
              </span>
              <button
                onClick={() => setShowBlockedHelp(false)}
                style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid #E3E1DB', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#5C5A55', fontSize: 18, lineHeight: 1 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px' }}>
              <p style={{ fontSize: 14, color: '#5C5A55', lineHeight: 1.65, fontWeight: 300, marginBottom: 20 }}>
                To enable, click on the lock icon in the address bar and in the drop down menu for notifications, choose Allow.
              </p>

              {/* Guide image */}
              <img
                src="/notif.png"
                alt="How to enable notifications"
                style={{ width: '100%', borderRadius: 10, border: '1px solid #E3E1DB' }}
              />
            </div>

            {/* Footer */}
            <div style={{
              padding: '14px 24px', borderTop: '1px solid #E3E1DB', background: '#F7F6F3',
              display: 'flex', justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => setShowBlockedHelp(false)}
                style={{
                  padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  background: '#D63B1F', color: '#fff', border: 'none', cursor: 'pointer',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Campaign pending/rejected/approved banner */}
      {campaignStatus === 'pending' && (
        <div style={{
          background: '#FFFBF0', borderBottom: '1px solid #E3E1DB',
          padding: '9px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexShrink: 0,
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#d97706', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: '#5C5A55', lineHeight: 1.5 }}>
            Your number is being set up — SMS usually activates within 10 minutes. You can still make and receive calls right away.
          </span>
        </div>
      )}
      {campaignStatus === 'rejected' && (
        <div style={{
          background: 'rgba(214,59,31,0.04)', borderBottom: '1px solid #E3E1DB',
          padding: '9px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexShrink: 0,
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#D63B1F', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: '#5C5A55', lineHeight: 1.5 }}>
            We ran into an issue activating SMS for this number. Please reach out to our support team and we&apos;ll get it sorted quickly.
          </span>
        </div>
      )}
      {campaignStatus === 'approved' && !approvalDismissed && (
        <div style={{
          background: 'rgba(22,163,74,0.04)', borderBottom: '1px solid #E3E1DB',
          padding: '9px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexShrink: 0,
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: '#5C5A55', lineHeight: 1.5 }}>
            Your number is all set — SMS is now active and ready to go.
          </span>
          <button onClick={dismissApproval} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B9890', padding: '0 2px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
      {/* Conversation List - Hidden on mobile when chat is open */}
      <div data-tour="left-panel" className={`${mobileView === 'chat' ? 'hidden' : 'flex'} md:flex w-full md:w-96 flex-col`} style={{ borderRight: '1px solid #E3E1DB' }}>
        <div className="sticky top-0 z-10" style={{ background: '#FFFFFF' }}>
          {/* Row 1: Chats/Calls tabs + call + compose icons */}
          <div className="flex items-center justify-between" style={{ padding: '12px 16px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => setInboxTab('chats')}
                style={{
                  fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em',
                  color: inboxTab === 'chats' ? '#131210' : '#9B9890',
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                  borderBottom: inboxTab === 'chats' ? '2px solid #D63B1F' : '2px solid transparent',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                }}>
                Chats
              </button>
              <button
                onClick={() => setInboxTab('calls')}
                style={{
                  fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em',
                  color: inboxTab === 'calls' ? '#131210' : '#9B9890',
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                  borderBottom: inboxTab === 'calls' ? '2px solid #D63B1F' : '2px solid transparent',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                }}>
                Calls
              </button>
            </div>
            <div data-tour="inbox-actions" style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
              {/* Call button */}
              <button
                onClick={() => { setShowDialer(v => !v); setDialerQuery(''); setDialerContacts([]) }}
                style={{
                  width: 36, height: 36, borderRadius: 7,
                  border: 'none', background: showDialer ? '#F7F6F3' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#5C5A55', cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3'; e.currentTarget.style.borderColor = '#D4D1C9' }}
                onMouseLeave={(e) => { if (!showDialer) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#E3E1DB' } }}
                title="Start a call"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/>
                </svg>
              </button>

              {/* Dialer dropdown — centered modal */}
              {showDialer && (
                <>
                  <div ref={dialerRef} style={{
                    position: 'fixed', top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 100, width: 480, background: '#1A1916',
                    border: '1px solid #2E2C29', borderRadius: 16,
                    boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
                    overflow: 'hidden',
                  }}>
                  {/* Header */}
                  <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid #2E2C29' }}>
                    <p style={{ fontSize: 15, fontWeight: 600, color: '#FFFFFF', marginBottom: 6 }}>Start a call</p>
                    <p style={{ fontSize: 12, color: '#6B6965', marginBottom: 12 }}>
                      From: <span style={{ color: '#C4C2BC', fontWeight: 500 }}>{selectedPhoneNumber?.phoneNumber || '—'}</span>
                    </p>
                    <div style={{ position: 'relative' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6965" strokeWidth="2" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}>
                        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                      </svg>
                      <input
                        autoFocus
                        value={dialerQuery}
                        onChange={e => setDialerQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const val = dialerQuery.replace(/\D/g, '')
                            if (val.length >= 10) handleDialerCall(dialerQuery.trim())
                          }
                          if (e.key === 'Escape') setShowDialer(false)
                        }}
                        placeholder="Enter a name or phone number..."
                        style={{
                          width: '100%', height: 40, borderRadius: 8,
                          border: '1px solid #3A3835', background: '#252320',
                          fontSize: 13, color: '#FFFFFF', padding: '0 12px 0 34px',
                          outline: 'none', fontFamily: 'inherit',
                        }}
                      />
                    </div>
                  </div>

                  {/* Results */}
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {dialerLoading && (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: '#6B6965' }}>Searching…</div>
                    )}
                    {!dialerLoading && dialerContacts.length > 0 && dialerContacts.map(c => {
                      const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.business_name || c.phone_number
                      return (
                        <button key={c.id} onClick={() => handleDialerCall(c.phone_number)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 14px', background: 'none', border: 'none',
                            cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#252320'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#D63B1F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF', lineHeight: 1.3 }}>{name}</p>
                            <p style={{ fontSize: 11, color: '#6B6965', lineHeight: 1.3 }}>{c.phone_number}</p>
                          </div>
                        </button>
                      )
                    })}
                    {/* Direct dial if query looks like a number */}
                    {dialerQuery.replace(/\D/g, '').length >= 6 && (
                      <button onClick={() => handleDialerCall(dialerQuery.trim())}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 14px', background: 'none', border: 'none',
                          cursor: 'pointer', textAlign: 'left', borderTop: dialerContacts.length ? '1px solid #2E2C29' : 'none',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#252320'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#D63B1F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="12" height="12" viewBox="0 0 20 20" fill="#fff"><path d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/></svg>
                        </div>
                        <div>
                          <p style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF', lineHeight: 1.3 }}>Call {dialerQuery.trim()}</p>
                          <p style={{ fontSize: 11, color: '#6B6965', lineHeight: 1.3 }}>Press Enter or click to dial</p>
                        </div>
                      </button>
                    )}
                    {!dialerLoading && dialerQuery.trim() && dialerContacts.length === 0 && dialerQuery.replace(/\D/g, '').length < 6 && (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: '#6B6965' }}>No contacts found</div>
                    )}
                    {!dialerQuery.trim() && (
                      <div style={{ padding: '12px 14px', fontSize: 12, color: '#6B6965' }}>Type a name or number to search</div>
                    )}
                  </div>
                </div>
                </>
              )}

              {/* Compose button */}
              <button
                onClick={() => {
                  setIsCreatingNewConversation(true)
                  setSelectedConversation(null)
                  setMobileView('chat')
                }}
                style={{
                  width: 36, height: 36, borderRadius: 7,
                  border: 'none', background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#5C5A55', cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3'; e.currentTarget.style.borderColor = '#D4D1C9' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#E3E1DB' }}
                title="New conversation"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5.99805 8.28223C6.30871 7.8939 6.78015 7.91224 7.08594 8.07715L7.20605 8.15625L7.26367 8.20703C7.31678 8.25917 7.36011 8.31812 7.39453 8.38086C7.63506 8.74097 7.53729 9.20196 7.27734 9.46191C7.25791 9.48133 7.23726 9.49944 7.21582 9.5166C6.89023 9.77707 6.38593 9.78403 6.05469 9.45312C5.76853 9.16697 5.72608 8.73269 5.92188 8.40137C5.94382 8.3598 5.96834 8.31936 5.99805 8.28223ZM9.33301 8.28223C9.64367 7.89396 10.1151 7.91225 10.4209 8.07715L10.541 8.15625L10.5986 8.20703C10.6517 8.25915 10.6951 8.31814 10.7295 8.38086C10.97 8.74093 10.8722 9.20197 10.6123 9.46191C10.5929 9.4813 10.5722 9.49945 10.5508 9.5166C10.2252 9.77705 9.72089 9.78397 9.38965 9.45312C9.10349 9.16697 9.06104 8.73269 9.25684 8.40137C9.27877 8.35981 9.30332 8.31935 9.33301 8.28223ZM12.665 8.28223C12.9757 7.89405 13.4472 7.91226 13.7529 8.07715L13.873 8.15625L13.9307 8.20703C13.9837 8.25913 14.0271 8.31818 14.0615 8.38086C14.3019 8.74088 14.2041 9.20197 13.9443 9.46191C13.925 9.48127 13.9042 9.49948 13.8828 9.5166C13.5573 9.77703 13.0529 9.78387 12.7217 9.45312C12.4355 9.16697 12.3931 8.73269 12.5889 8.40137C12.6108 8.35984 12.6354 8.31932 12.665 8.28223ZM15 1.875C16.6954 1.875 18.125 3.18821 18.125 4.875V12.792C18.1248 14.4786 16.6953 15.792 15 15.792H13.958V18.333C13.958 18.5704 13.824 18.788 13.6113 18.8936C13.3986 18.9991 13.1441 18.9747 12.9551 18.8311L8.95605 15.792H5C3.30469 15.792 1.87518 14.4786 1.875 12.792V4.875C1.875 3.18821 3.30458 1.875 5 1.875H15ZM5 3.125C3.93375 3.125 3.125 3.93821 3.125 4.875V12.792C3.12519 13.7286 3.93387 14.542 5 14.542H9.16699C9.30347 14.5421 9.43626 14.5864 9.54492 14.6689L12.708 17.0723V15.167C12.708 14.8219 12.988 14.5422 13.333 14.542H15C16.0661 14.542 16.8748 13.7286 16.875 12.792V4.875C16.875 3.93821 16.0663 3.125 15 3.125H5Z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Chats: Filter tabs + Search */}
          {inboxTab === 'chats' && (
            <>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid #E3E1DB' }}>
                <FilterTabs currentFilter={filter} onFilterChange={setFilter} conversations={filteredConversations} />
              </div>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid #E3E1DB' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search conversations..."
                  style={{
                    width: '100%', height: 32,
                    border: '1px solid #E3E1DB', borderRadius: 7,
                    background: '#F7F6F3',
                    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                    fontSize: 12, color: '#131210',
                    padding: '0 10px 0 30px', outline: 'none',
                    backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239B9890' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='M21 21l-4.35-4.35'/%3E%3C/svg%3E\")",
                    backgroundRepeat: 'no-repeat', backgroundPosition: '10px center',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = '#D4D1C9' }}
                  onBlur={(e) => { e.target.style.borderColor = '#E3E1DB' }}
                />
              </div>
            </>
          )}

          {/* Calls: Filter tabs */}
          {inboxTab === 'calls' && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #E3E1DB', display: 'flex', gap: 4 }}>
              {[
                { id: 'all', label: 'All' },
                { id: 'missed', label: 'Missed' },
                { id: 'forwarded', label: 'Forwarded' },
              ].map(f => (
                <button key={f.id} onClick={() => setCallFilter(f.id)}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                    background: callFilter === f.id ? 'rgba(214,59,31,0.07)' : 'transparent',
                    color: callFilter === f.id ? '#D63B1F' : '#9B9890',
                    fontWeight: callFilter === f.id ? 500 : 400,
                    transition: 'all 0.15s',
                  }}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* ── CHATS TAB ── */}
          {inboxTab === 'chats' && (
            <>
              {phoneNumbers.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="mx-auto mb-4 flex items-center justify-center" style={{ width: 48, height: 48, borderRadius: 13, background: '#EFEDE8', border: '1px solid #E3E1DB' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.5">
                      <path d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210', marginBottom: 4 }}>No phone numbers available</p>
                  <p style={{ fontSize: '12.5px', color: '#9B9890', marginBottom: 16 }}>Purchase phone numbers to start messaging</p>
                  <button
                    onClick={() => router.push('/settings?tab=numbers')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                      background: '#D63B1F', color: '#fff', padding: '9px 18px',
                      borderRadius: 8, fontSize: '12.5px', fontWeight: 500,
                      border: 'none', cursor: 'pointer', transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88' }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                  >
                    Buy Phone Number
                  </button>
                </div>
              ) : !selectedPhoneNumber ? (
                <div className="p-8 text-center">
                  <div className="mx-auto mb-4 flex items-center justify-center" style={{ width: 48, height: 48, borderRadius: 13, background: '#EFEDE8', border: '1px solid #E3E1DB' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.5">
                      <path d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210', marginBottom: 4 }}>No phone number selected</p>
                  <p style={{ fontSize: '12.5px', color: '#9B9890' }}>Choose a phone number from the sidebar</p>
                </div>
              ) : conversationsLoading ? (
                <SkeletonLoader type="conversations" />
              ) : (
                <ConversationList
                  conversations={filteredConversations}
                  loading={conversationsLoading}
                  selectedConversation={selectedConversation}
                  onConversationSelect={handleConversationSelect}
                  formatPhoneNumber={formatPhoneNumber}
                  onDeleteConversation={handleDeleteConversation}
                  onMarkAsRead={handleMarkAsRead}
                  onMarkAsUnread={handleMarkAsUnread}
                  onMarkAsDone={handleMarkAsDone}
                  onMarkAsOpen={handleMarkAsOpen}
                  onPinConversation={handlePinConversation}
                  onBlockContact={handleBlockContact}
                  onAssignScenario={handleAssignScenario}
                  callHook={callHook}
                  isCreatingNew={isCreatingNewConversation}
                />
              )}
            </>
          )}

          {/* ── CALLS TAB ── */}
          {inboxTab === 'calls' && (
            <>
              {callsLoading ? (
                <SkeletonLoader type="conversations" />
              ) : calls.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="mx-auto mb-4 flex items-center justify-center" style={{ width: 48, height: 48, borderRadius: 13, background: '#EFEDE8', border: '1px solid #E3E1DB' }}>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="#9B9890">
                      <path d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/>
                    </svg>
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210', marginBottom: 4 }}>No calls yet</p>
                  <p style={{ fontSize: '12.5px', color: '#9B9890' }}>Your call history will appear here</p>
                </div>
              ) : (
                calls.filter(c => {
                  if (callFilter === 'missed') return c.status === 'missed'
                  if (callFilter === 'forwarded') return c.status === 'forwarded' || c.forwarded_to
                  return true
                }).map((call) => {
                  const isIncoming = call.direction === 'inbound' || call.direction === 'incoming'
                  const isMissed = call.status === 'missed'
                  const isForwarded = call.status === 'forwarded' || call.forwarded_to
                  const contactNumber = isIncoming ? call.from_number : call.to_number
                  const duration = call.duration_seconds
                    ? `${Math.floor(call.duration_seconds / 60)}:${String(call.duration_seconds % 60).padStart(2, '0')}`
                    : null
                  const time = new Date(call.created_at)
                  const now = new Date()
                  const diffDays = Math.floor((now - time) / (1000 * 60 * 60 * 24))
                  const timeStr = diffDays === 0
                    ? time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                    : diffDays < 7
                      ? time.toLocaleDateString('en-US', { weekday: 'short' })
                      : time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

                  return (
                    <div
                      key={call.id}
                      onClick={() => {
                        // Navigate to the conversation for this phone number
                        const conv = filteredConversations?.find(c =>
                          c.phone_number?.replace(/\D/g, '').slice(-10) === contactNumber?.replace(/\D/g, '').slice(-10)
                        )
                        if (conv) {
                          handleConversationSelect(conv)
                          setInboxTab('chats')
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 11,
                        padding: '11px 14px', borderBottom: '1px solid #E3E1DB',
                        cursor: 'pointer', transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#F7F6F3' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      {/* Direction icon */}
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                        background: isMissed ? 'rgba(214,59,31,0.07)' : isForwarded ? 'rgba(214,59,31,0.07)' : '#EFEDE8',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isMissed ? (
                          <svg width="14" height="14" viewBox="0 0 20 20" fill="#D63B1F">
                            <path d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/>
                          </svg>
                        ) : isIncoming ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5A55" strokeWidth="2" strokeLinecap="round">
                            <polyline points="7 17 17 7"/>
                            <polyline points="7 7 7 17 17 17"/>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5C5A55" strokeWidth="2" strokeLinecap="round">
                            <polyline points="17 7 7 17"/>
                            <polyline points="17 17 17 7 7 7"/>
                          </svg>
                        )}
                      </div>

                      {/* Call info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                          <span style={{
                            fontSize: '12.5px', fontWeight: 500,
                            color: isMissed ? '#D63B1F' : '#131210',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {formatPhoneNumber ? formatPhoneNumber(contactNumber) : contactNumber}
                          </span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9.5px', color: '#9B9890', flexShrink: 0, marginLeft: 8 }}>
                            {timeStr}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: '11.5px', color: '#9B9890', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {isMissed ? 'Missed call' : isForwarded ? `Forwarded to ${call.forwarded_to}` : isIncoming ? 'Incoming call' : 'Outgoing call'}
                            {duration && ` · ${duration}`}
                          </span>
                          {isMissed && (
                            <span style={{
                              fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                              fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase',
                              background: 'rgba(214,59,31,0.07)', color: '#D63B1F', letterSpacing: '0.05em',
                            }}>Missed</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </>
          )}
        </div>
      </div>

      {/* Chat Window - Full width on mobile when open */}
      <div data-tour="chat-window" className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-1`}>
        {isCreatingNewConversation ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <NewConversationView
              phoneNumber={selectedPhoneNumber}
              formatPhoneNumber={formatPhoneNumber}
              onConversationCreated={handleNewConversationCreated}
              onCancel={() => {
                setIsCreatingNewConversation(false)
                setMobileView('list')
              }}
              user={user}
            />
          </div>
        ) : activeConversation ? (
          <>
            <div className="flex-1 min-h-0 flex flex-col">
              <ChatWindow
                conversation={activeConversation}
                messages={messages}
                loading={messagesLoading}
                phoneNumber={selectedPhoneNumber}
                formatPhoneNumber={formatPhoneNumber}
                addOptimisticMessage={addOptimisticMessage}
                replaceOptimisticMessage={replaceOptimisticMessage}
                removeOptimisticMessage={removeOptimisticMessage}
                onRefreshConversations={refetch}
                user={user}
                onClose={handleConversationDeselect}
                callHook={callHook}
                onBackToList={() => setMobileView('list')}
                mobileView={mobileView}
                onMarkAsRead={handleMarkAsRead}
                onMarkAsUnread={handleMarkAsUnread}
                onMarkAsDone={handleMarkAsDone}
                onMarkAsOpen={handleMarkAsOpen}
                onPinConversation={handlePinConversation}
                onBlockContact={handleBlockContact}
                onDeleteConversation={handleDeleteConversation}
                onAssignScenario={handleAssignScenario}
              />
            </div>

            {/* Contact Panel - Always visible on desktop, hidden on mobile */}
            <div data-tour="contact-panel" className="hidden lg:block w-[340px] overflow-y-auto" style={{ borderLeft: '1px solid #E3E1DB', background: '#FFFFFF' }}>
              <ContactPanel
                conversation={activeConversation}
                formatPhoneNumber={formatPhoneNumber}
                user={user}
                highlightNoteId={highlightNoteId}
                onContactUpdated={(updatedContact) => {
                  if (updatedContact && activeConversation) {
                    const firstName = updatedContact.first_name || null
                    const lastName = updatedContact.last_name || null
                    const personalName = [firstName, lastName].filter(Boolean).join(' ')
                    const contactName = personalName || updatedContact.business_name || null
                    updateConversationOptimistic(activeConversation.id, {
                      contact_first_name: firstName,
                      contact_last_name: lastName,
                      name: contactName || activeConversation.name,
                    })
                  }
                  refetch(true)
                }}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8" style={{ background: '#F7F6F3' }}>
            <div className="text-center" style={{ maxWidth: 280 }}>
              <div className="mx-auto mb-4 flex items-center justify-center" style={{ width: 48, height: 48, borderRadius: 13, background: '#EFEDE8', border: '1px solid #E3E1DB' }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="#9B9890">
                  <path d="M5.99805 8.28223C6.30871 7.8939 6.78015 7.91224 7.08594 8.07715L7.20605 8.15625L7.26367 8.20703C7.31678 8.25917 7.36011 8.31812 7.39453 8.38086C7.63506 8.74097 7.53729 9.20196 7.27734 9.46191C7.25791 9.48133 7.23726 9.49944 7.21582 9.5166C6.89023 9.77707 6.38593 9.78403 6.05469 9.45312C5.76853 9.16697 5.72608 8.73269 5.92188 8.40137C5.94382 8.3598 5.96834 8.31936 5.99805 8.28223ZM9.33301 8.28223C9.64367 7.89396 10.1151 7.91225 10.4209 8.07715L10.541 8.15625L10.5986 8.20703C10.6517 8.25915 10.6951 8.31814 10.7295 8.38086C10.97 8.74093 10.8722 9.20197 10.6123 9.46191C10.5929 9.4813 10.5722 9.49945 10.5508 9.5166C10.2252 9.77705 9.72089 9.78397 9.38965 9.45312C9.10349 9.16697 9.06104 8.73269 9.25684 8.40137C9.27877 8.35981 9.30332 8.31935 9.33301 8.28223ZM12.665 8.28223C12.9757 7.89405 13.4472 7.91226 13.7529 8.07715L13.873 8.15625L13.9307 8.20703C13.9837 8.25913 14.0271 8.31818 14.0615 8.38086C14.3019 8.74088 14.2041 9.20197 13.9443 9.46191C13.925 9.48127 13.9042 9.49948 13.8828 9.5166C13.5573 9.77703 13.0529 9.78387 12.7217 9.45312C12.4355 9.16697 12.3931 8.73269 12.5889 8.40137C12.6108 8.35984 12.6354 8.31932 12.665 8.28223ZM15 1.875C16.6954 1.875 18.125 3.18821 18.125 4.875V12.792C18.1248 14.4786 16.6953 15.792 15 15.792H13.958V18.333C13.958 18.5704 13.824 18.788 13.6113 18.8936C13.3986 18.9991 13.1441 18.9747 12.9551 18.8311L8.95605 15.792H5C3.30469 15.792 1.87518 14.4786 1.875 12.792V4.875C1.875 3.18821 3.30458 1.875 5 1.875H15ZM5 3.125C3.93375 3.125 3.125 3.93821 3.125 4.875V12.792C3.12519 13.7286 3.93387 14.542 5 14.542H9.16699C9.30347 14.5421 9.43626 14.5864 9.54492 14.6689L12.708 17.0723V15.167C12.708 14.8219 12.988 14.5422 13.333 14.542H15C16.0661 14.542 16.8748 13.7286 16.875 12.792V4.875C16.875 3.93821 16.0663 3.125 15 3.125H5Z"/>
                </svg>
              </div>
              <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210', marginBottom: 4 }}>Select a conversation</h3>
              <p style={{ fontSize: '12.5px', color: '#9B9890', lineHeight: 1.6, marginBottom: 20 }}>Choose a conversation from the list to start messaging</p>
              {selectedPhoneNumber && (
                <button
                  onClick={() => setIsCreatingNewConversation(true)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    background: '#D63B1F', color: '#fff', padding: '9px 18px',
                    borderRadius: 8, fontSize: '12.5px', fontWeight: 500,
                    border: 'none', cursor: 'pointer', transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Start new conversation
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      </div>{/* end flex-1 overflow-hidden */}

      {callHook && (
        <CallInterface
          callStatus={callHook.callStatus}
          currentCall={callHook.currentCall}
          incomingCall={callHook.incomingCall}
          callDuration={callHook.callDuration}
          isCallActive={callHook.isCallActive}
          onAcceptCall={callHook.acceptCall}
          onRejectCall={callHook.rejectCall}
          onEndCall={callHook.endCall}
          onToggleMute={callHook.toggleMute}
          onToggleHold={callHook.toggleHold}
          onSendDTMF={callHook.sendDTMF}
          formatPhoneNumber={formatPhoneNumber}
          availablePhoneNumbers={callHook.availablePhoneNumbers}
          phoneNumbers={phoneNumbers}
          callHook={callHook}
        />
      )}

      {assignScenarioModal && (
        <AssignScenarioModal
          conversationId={assignScenarioModal.conversationId}
          phoneNumber={assignScenarioModal.phoneNumber}
          onClose={() => setAssignScenarioModal(null)}
        />
      )}

    </div>
  )
}

function AssignScenarioModal({ conversationId, phoneNumber, onClose }) {
  const [scenarios, setScenarios] = useState([])
  const [currentScenarioId, setCurrentScenarioId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null) // null = no change yet

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        // Fetch active scenarios for workspace (needs workspace auth headers)
        const [scenariosRes, assignmentRes] = await Promise.all([
          fetchWithWorkspace('/api/scenarios'),
          fetchWithWorkspace(`/api/conversations/assign-scenario?conversationId=${conversationId}`)
        ])
        const [scenariosData, assignmentData] = await Promise.all([
          scenariosRes.json(),
          assignmentRes.json()
        ])
        if (scenariosData.success) setScenarios(scenariosData.scenarios?.filter(s => s.is_active) || [])
        if (assignmentData.success) {
          const id = assignmentData.assignedScenario?.id || null
          setCurrentScenarioId(id)
          setSelected(id)
        }
      } catch (e) {
        console.error('Error loading scenarios:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [conversationId])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetchWithWorkspace('/api/conversations/assign-scenario', {
        method: 'POST',
        body: JSON.stringify({ conversationId, scenarioId: selected })
      })
      const data = await res.json()
      if (data.success) {
        onClose()
      }
    } catch (e) {
      console.error('Error assigning scenario:', e)
    } finally {
      setSaving(false)
    }
  }

  const hasChange = selected !== currentScenarioId

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(19,18,16,0.3)' }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #E3E1DB', borderRadius: 14, width: '100%', maxWidth: 400, boxShadow: '0 20px 56px rgba(19,18,16,0.12)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #E3E1DB' }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210' }}>Assign Scenario</h3>
            <p style={{ fontSize: 11, color: '#9B9890', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>{phoneNumber}</p>
          </div>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #E3E1DB', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9B9890', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: '#9B9890' }}>
              Loading scenarios…
            </div>
          ) : scenarios.length === 0 ? (
            <p style={{ fontSize: 13, color: '#5C5A55', textAlign: 'center', padding: '16px 0' }}>No active scenarios found.</p>
          ) : (
            <div className="space-y-2">
              {/* None option */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', border: `1px solid ${selected === null ? '#D63B1F' : '#E3E1DB'}`, borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s', background: selected === null ? 'rgba(214,59,31,0.07)' : 'transparent' }}>
                <input type="radio" name="scenario" value="" checked={selected === null} onChange={() => setSelected(null)} style={{ accentColor: '#D63B1F' }} />
                <div>
                  <p style={{ fontSize: '12.5px', fontWeight: 500, color: '#131210' }}>None</p>
                  <p style={{ fontSize: '11.5px', color: '#9B9890', marginTop: 2 }}>Use default scenario matching</p>
                </div>
              </label>
              {scenarios.map(s => (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', border: `1px solid ${selected === s.id ? '#D63B1F' : '#E3E1DB'}`, borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s', background: selected === s.id ? 'rgba(214,59,31,0.07)' : 'transparent' }}>
                  <input type="radio" name="scenario" value={s.id} checked={selected === s.id} onChange={() => setSelected(s.id)} style={{ accentColor: '#D63B1F' }} />
                  <div>
                    <p style={{ fontSize: '12.5px', fontWeight: 500, color: '#131210' }}>{s.name}</p>
                    {s.instructions && <p style={{ fontSize: '11.5px', color: '#9B9890', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{s.instructions}</p>}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '14px 24px', borderTop: '1px solid #E3E1DB', background: '#F7F6F3' }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #D4D1C9', color: '#5C5A55', padding: '8px 18px', borderRadius: 7, fontSize: '12.5px', cursor: 'pointer', transition: 'all 0.15s' }}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChange || loading}
            style={{ background: '#D63B1F', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 7, fontSize: '12.5px', fontWeight: 500, cursor: saving || !hasChange || loading ? 'not-allowed' : 'pointer', opacity: saving || !hasChange || loading ? 0.5 : 1, transition: 'opacity 0.15s' }}
          >
            {saving ? 'Saving…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}
