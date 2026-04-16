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
  const [workspaceId, setWorkspaceId] = useState(null)

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

  const campaignStatus = selectedPhoneNumber?.campaign_status
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
    <div className="flex flex-col h-full" style={{ background: '#FFFFFF' }}>
      {/* Campaign pending/rejected/approved banner */}
      {campaignStatus === 'pending' && (
        <div style={{
          background: '#FFF8E6', borderBottom: '1px solid #F5D87A',
          padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 0
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span style={{ fontSize: 12.5, color: '#92400E' }}>
            <strong>Your number is pending 10DLC campaign approval.</strong> SMS delivery may be limited until carriers approve it — usually within a few hours.
          </span>
        </div>
      )}
      {campaignStatus === 'rejected' && (
        <div style={{
          background: '#FEF2F2', borderBottom: '1px solid #FCA5A5',
          padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 0
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#991B1B" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span style={{ fontSize: 12.5, color: '#991B1B' }}>
            <strong>10DLC campaign registration was rejected for this number.</strong> Please contact support to resolve this before sending SMS.
          </span>
        </div>
      )}
      {campaignStatus === 'approved' && !approvalDismissed && (
        <div style={{
          background: '#F0FDF4', borderBottom: '1px solid #86EFAC',
          padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 0
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span style={{ fontSize: 12.5, color: '#15803D', flex: 1, textAlign: 'center' }}>
            <strong>Your number is approved!</strong> All carriers have verified your 10DLC registration — you&apos;re ready to send SMS.
          </span>
          <button onClick={dismissApproval} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#15803D', opacity: 0.6, padding: '0 4px', flexShrink: 0, fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
      {/* Conversation List - Hidden on mobile when chat is open */}
      <div className={`${mobileView === 'chat' ? 'hidden' : 'flex'} md:flex w-full md:w-96 flex-col`} style={{ borderRight: '1px solid #E3E1DB' }}>
        <div className="sticky top-0 z-10" style={{ background: '#FFFFFF' }}>
          {/* Row 1: Chats tab + compose icon */}
          <div className="flex items-center justify-between" style={{ padding: '12px 16px 8px' }}>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210' }}>Chats</span>
            <button
              onClick={() => {
                setIsCreatingNewConversation(true)
                setSelectedConversation(null)
                setMobileView('chat')
              }}
              style={{
                width: 26, height: 26, borderRadius: 6,
                border: '1px solid #E3E1DB', background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#5C5A55', cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3'; e.currentTarget.style.borderColor = '#D4D1C9' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#E3E1DB' }}
              title="New conversation"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
            </button>
          </div>

          {/* Row 2: Filter tabs */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #E3E1DB' }}>
            <FilterTabs currentFilter={filter} onFilterChange={setFilter} conversations={filteredConversations} />
          </div>

          {/* Row 3: Search */}
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
                padding: '0 10px 0 30px',
                outline: 'none',
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239B9890' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='M21 21l-4.35-4.35'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: '10px center',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.target.style.borderColor = '#D4D1C9' }}
              onBlur={(e) => { e.target.style.borderColor = '#E3E1DB' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
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
        </div>
      </div>

      {/* Chat Window - Full width on mobile when open */}
      <div className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-1`}>
        {isCreatingNewConversation ? (
          <div className="flex-1">
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
            <div className="flex-1">
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
            <div className="hidden lg:block w-[340px] overflow-y-auto" style={{ borderLeft: '1px solid #E3E1DB', background: '#FFFFFF' }}>
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                  <path d="M8 10h.01M12 10h.01M16 10h.01"/>
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
