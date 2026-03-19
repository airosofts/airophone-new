'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'
import { validateAndUpgradeSession } from '@/lib/session-validator'
import ConversationList from '@/components/inbox/ConversationList'
import ChatWindow from '@/components/inbox/ChatWindow'
import ContactPanel from '@/components/inbox/ContactPanel'
import NewConversationView from '@/components/inbox/NewConversationView'
import FilterTabs from '@/components/inbox/FilterTabs'
import CallInterface from '@/components/calling/CallInterface'
import { useRealtimeConversations, useRealtimeMessages } from '@/hooks/useRealtime'
import { useWebRTCCall } from '@/hooks/useWebRTCCall'
import SkeletonLoader from '@/components/ui/skeleton-loader'

export default function InboxPage() {
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [isCreatingNewConversation, setIsCreatingNewConversation] = useState(false)

  const [filter, setFilter] = useState('all')
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
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
    ? allMessages.filter(msg => {
        if (msg.isOptimistic) return true
        const normalize = (p) => p ? p.replace(/\D/g, '').replace(/^1/, '') : ''
        const line = normalize(selectedLineNumber)
        if (msg.direction === 'outbound') return normalize(msg.from_number) === line
        if (msg.direction === 'inbound') return normalize(msg.to_number) === line
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
        } catch (error) {
          console.error('Error parsing user session:', error)
          const currentUser = getCurrentUser()
          setUser(currentUser)
        }
      } else {
        const currentUser = getCurrentUser()
        setUser(currentUser)
      }

      // Fetch phone numbers
      try {
        const response = await apiGet('/api/phone-numbers')
        const data = await response.json()
        if (data.success) {
          setPhoneNumbers(data.phoneNumbers || [])
        }
      } catch (error) {
        console.error('Error fetching phone numbers:', error)
      } finally {
        setLoading(false)
      }
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

  // Listen for notification-navigate events from sidebar
  useEffect(() => {
    const handleNotificationNavigate = (e) => {
      const { conversationId, noteId } = e.detail
      if (!conversationId) return
      // Find the conversation in the list
      const conv = conversations.find(c => c.id === conversationId)
      if (conv) {
        handleConversationSelect(conv)
        if (noteId) {
          setHighlightNoteId(noteId)
          // Auto-clear highlight after 3s
          setTimeout(() => setHighlightNoteId(null), 3000)
          // Scroll to the note after a short delay
          setTimeout(() => {
            const noteEl = document.getElementById(`note-${noteId}`)
            if (noteEl) noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 500)
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
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-[#C54A3F]/20 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-[#C54A3F] border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="text-gray-600 font-medium">Loading user session...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-white">
      {/* Conversation List - Hidden on mobile when chat is open */}
      <div className={`${mobileView === 'chat' ? 'hidden' : 'flex'} md:flex w-full md:w-96 border-r border-gray-200 flex-col`}>
        <div className="bg-white sticky top-0 z-10">
          {/* Row 1: Chats tab + compose icon */}
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Chats</span>
            <button
              onClick={() => {
                setIsCreatingNewConversation(true)
                setSelectedConversation(null)
                setMobileView('chat')
              }}
              className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
              title="New conversation"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#C54A3F]">
                <path fillRule="evenodd" clipRule="evenodd" d="M15.1285 1.66675C16.8917 1.66675 18.3337 3.03489 18.3337 4.73971V12.8489L18.3282 13.0303C18.2303 14.6497 16.8287 15.9219 15.1285 15.9219L14.0608 15.9212L14.0602 18.5254L14.0532 18.6219C13.985 19.09 13.4269 19.3354 13.0313 19.0351L8.92956 15.9212L4.87212 15.9219C3.109 15.9219 1.66699 14.5537 1.66699 12.8489V4.73971C1.66699 3.03489 3.109 1.66675 4.87212 1.66675H15.1285ZM15.1285 2.94715H4.87212C3.80276 2.94715 2.94904 3.75714 2.94904 4.73971V12.8489C2.94904 13.8315 3.80276 14.6415 4.87212 14.6415H9.14562L9.24965 14.65C9.3523 14.6668 9.44984 14.7085 9.5335 14.772L12.7788 17.2344L12.7781 15.2817C12.7781 14.9281 13.0651 14.6415 13.4191 14.6415H15.1285C16.1979 14.6415 17.0516 13.8315 17.0516 12.8489V4.73971C17.0516 3.75714 16.1979 2.94715 15.1285 2.94715ZM14.1077 8.27685C14.0672 8.21813 14.0175 8.16426 13.9588 8.11741C13.6052 7.83486 13.06 7.85665 12.7502 8.2433L12.6925 8.3264L12.6618 8.38077C12.4778 8.71014 12.526 9.13374 12.8063 9.41372C13.1245 9.73151 13.6276 9.75084 13.969 9.47806L14.0585 9.3795C14.3042 9.07481 14.3451 8.69488 14.1808 8.39597L14.1077 8.27685ZM10.5415 8.11741C10.6002 8.16426 10.6499 8.21813 10.6904 8.27685L10.7635 8.39597C10.9278 8.69488 10.8869 9.07481 10.6412 9.3795L10.5517 9.47806C10.2103 9.75084 9.70723 9.73151 9.38903 9.41372C9.10869 9.13374 9.06051 8.71014 9.24452 8.38077L9.27516 8.3264L9.33294 8.2433C9.64266 7.85665 10.1879 7.83486 10.5415 8.11741ZM7.2701 8.27685C7.22957 8.21813 7.17986 8.16426 7.12122 8.11741C6.76759 7.83486 6.22236 7.85665 5.91264 8.2433L5.85486 8.3264L5.82422 8.38077C5.64021 8.71014 5.68839 9.13374 5.96873 9.41372C6.28693 9.73151 6.79 9.75084 7.1314 9.47806L7.2209 9.3795C7.46664 9.07481 7.50748 8.69488 7.34316 8.39597L7.2701 8.27685Z" fill="currentColor" />
              </svg>
            </button>
          </div>

          {/* Row 2: Filter chips */}
          <div className="px-3 pb-2.5">
            <FilterTabs currentFilter={filter} onFilterChange={setFilter} conversations={filteredConversations} />
          </div>

          <div className="border-b border-gray-100" />
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {phoneNumbers.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900 mb-2">No phone numbers available</p>
              <p className="text-xs text-gray-500 mb-4">Purchase phone numbers to start messaging</p>
              <button
                onClick={() => router.push('/settings?tab=numbers')}
                className="px-4 py-2 bg-[#C54A3F] hover:bg-[#B73E34] text-white text-sm font-medium rounded-md transition-colors"
              >
                Buy Phone Number
              </button>
            </div>
          ) : !selectedPhoneNumber ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900 mb-1">No phone number selected</p>
              <p className="text-xs text-gray-500">Choose a phone number from the sidebar</p>
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
            <div className="hidden lg:block w-[340px] border-l border-gray-200 bg-white overflow-y-auto">
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
          <div className="flex-1 flex items-center justify-center bg-white p-8">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-5">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Select a conversation</h3>
              <p className="text-sm text-gray-500 mb-6">Choose a conversation from the list to start messaging</p>
              {selectedPhoneNumber && (
                <button
                  onClick={() => setIsCreatingNewConversation(true)}
                  className="px-4 py-2 bg-[#C54A3F] hover:bg-[#B73E34] text-white text-sm font-medium rounded-md transition-colors"
                >
                  Start new conversation
                </button>
              )}
            </div>
          </div>
        )}
      </div>

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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Assign Scenario</h3>
            <p className="text-xs text-gray-400 mt-0.5">{phoneNumber}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="py-6 text-center text-sm text-gray-400">
              <i className="fas fa-spinner fa-spin mr-2"></i>Loading scenarios…
            </div>
          ) : scenarios.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No active scenarios found.</p>
          ) : (
            <div className="space-y-2">
              {/* None option */}
              <label className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${selected === null ? 'border-[#C54A3F] bg-red-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <input type="radio" name="scenario" value="" checked={selected === null} onChange={() => setSelected(null)} className="accent-[#C54A3F]" />
                <div>
                  <p className="text-sm font-medium text-gray-700">None</p>
                  <p className="text-xs text-gray-400">Use default scenario matching</p>
                </div>
              </label>
              {scenarios.map(s => (
                <label key={s.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${selected === s.id ? 'border-[#C54A3F] bg-red-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="radio" name="scenario" value={s.id} checked={selected === s.id} onChange={() => setSelected(s.id)} className="accent-[#C54A3F]" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{s.name}</p>
                    {s.instructions && <p className="text-xs text-gray-400 truncate max-w-[200px]">{s.instructions}</p>}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !hasChange || loading}
            className="px-4 py-1.5 text-sm font-medium text-white bg-[#C54A3F] hover:bg-[#B73E34] rounded-md disabled:opacity-50"
          >
            {saving ? <><i className="fas fa-spinner fa-spin mr-1.5"></i>Saving…</> : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}
