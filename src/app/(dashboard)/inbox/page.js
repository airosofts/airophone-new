'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { apiGet } from '@/lib/api-client'
import { validateAndUpgradeSession } from '@/lib/session-validator'
import ConversationList from '@/components/inbox/ConversationList'
import ChatWindow from '@/components/inbox/ChatWindow'
import ContactPanel from '@/components/inbox/ContactPanel'
import NewMessageModal from '@/components/inbox/NewMessageModal'
import FilterTabs from '@/components/inbox/FilterTabs'
import CallInterface from '@/components/calling/CallInterface'
import { useRealtimeConversations, useRealtimeMessages } from '@/hooks/useRealtime'
import { useWebRTCCall } from '@/hooks/useWebRTCCall'
import SkeletonLoader from '@/components/ui/skeleton-loader'

export default function InboxPage() {
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [showNewMessageModal, setShowNewMessageModal] = useState(false)
  const [showContactPanel, setShowContactPanel] = useState(false)
  const [filter, setFilter] = useState('all')
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mobileView, setMobileView] = useState('list') // 'list' | 'chat' | 'contact'

  const searchParams = useSearchParams()
  const router = useRouter()
  const audioRef = useRef(null)

  const callHook = useWebRTCCall()

  const fromParam = searchParams.get('from')
  const selectedPhoneNumber = phoneNumbers.find(p => p.phoneNumber === fromParam) || phoneNumbers[0] || null

  const { conversations, loading: conversationsLoading, refetch, setActiveConversation, deleteConversation, updateConversationOptimistic } = useRealtimeConversations(selectedPhoneNumber?.phoneNumber)
  const { messages, loading: messagesLoading, addOptimisticMessage, replaceOptimisticMessage, removeOptimisticMessage } = useRealtimeMessages(selectedConversation?.id)

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
      audioRef.current = new Audio('/notification.mp3')
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

  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.direction === 'inbound' && lastMessage.created_at && !lastMessage.isOptimistic) {
        const messageTime = new Date(lastMessage.created_at)
        const now = new Date()
        if (now - messageTime < 30000) {
          if (audioRef.current) {
            audioRef.current.play().catch(console.error)
          }
        }
      }
    }
  }, [messages])

  const handleConversationSelect = async (conversation) => {
    setActiveConversation(conversation.id)
    setSelectedConversation(conversation)
    setShowContactPanel(false)
    setMobileView('chat') // Switch to chat view on mobile

    if (user && user.userId) {
      try {
        updateConversationOptimistic(conversation.id, { unreadCount: 0 })

        const response = await fetch('/api/conversations/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: conversation.id,
            userId: user.userId
          }),
        })

        if (!response.ok) {
          updateConversationOptimistic(conversation.id, { unreadCount: conversation.unreadCount })
        }
      } catch (error) {
        console.error('Error marking messages as read:', error)
        updateConversationOptimistic(conversation.id, { unreadCount: conversation.unreadCount })
      }
    }
  }

  const handleConversationDeselect = () => {
    setActiveConversation(null)
    setSelectedConversation(null)
    setShowContactPanel(false)
    setMobileView('list') // Go back to list on mobile
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

  const filteredConversations = conversations.filter(conv => {
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
          <div className="px-4 pt-4 pb-3 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
            <button
              onClick={() => setShowNewMessageModal(true)}
              className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors"
              title="New message"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <div className="px-4 pb-2">
            <p className="text-sm text-gray-600">
              {selectedPhoneNumber ? formatPhoneNumber(selectedPhoneNumber.phoneNumber) : 'No number selected'}
            </p>
          </div>

          <div className="border-b border-gray-200">
            <FilterTabs currentFilter={filter} onFilterChange={setFilter} conversations={filteredConversations} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {phoneNumbers.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-red-100 to-red-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900 mb-2">No phone numbers available</p>
              <p className="text-xs text-gray-500 mb-4">Purchase phone numbers to start messaging</p>
              <button
                onClick={() => router.push('/settings?tab=numbers')}
                className="px-6 py-2.5 bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] text-white rounded-lg font-semibold shadow-lg transition-all duration-200 hover:scale-105"
              >
                Buy Phone Number
              </button>
            </div>
          ) : !selectedPhoneNumber ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
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
              onMarkAsUnread={handleMarkAsUnread}
              onMarkAsDone={handleMarkAsDone}
              onMarkAsOpen={handleMarkAsOpen}
              onPinConversation={handlePinConversation}
              callHook={callHook}
            />
          )}
        </div>
      </div>

      {/* Chat Window - Full width on mobile when open */}
      <div className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-1`}>
        {selectedConversation ? (
          <>
            <div className="flex-1">
              <ChatWindow
                conversation={selectedConversation}
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
                onMarkAsUnread={handleMarkAsUnread}
                onMarkAsDone={handleMarkAsDone}
              />
            </div>

            {/* Contact Panel - Always visible on desktop, hidden on mobile */}
            <div className="hidden lg:block w-80 border-l border-gray-200 bg-white overflow-y-auto">
              <ContactPanel
                conversation={selectedConversation}
                formatPhoneNumber={formatPhoneNumber}
                user={user}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-gray-50 to-white p-8">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 bg-gradient-to-br from-[#C54A3F]/10 to-[#B73E34]/10 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                <svg className="w-10 h-10 text-[#C54A3F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Select a conversation</h3>
              <p className="text-gray-500 mb-8">Choose a conversation from the list to start messaging</p>
              {selectedPhoneNumber && (
                <button
                  onClick={() => setShowNewMessageModal(true)}
                  className="px-8 py-3.5 bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] text-white rounded-xl font-semibold shadow-lg shadow-[#C54A3F]/30 transition-all duration-200 hover:scale-105 active:scale-95"
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

      {showNewMessageModal && (
        <NewMessageModal
          phoneNumber={selectedPhoneNumber}
          formatPhoneNumber={formatPhoneNumber}
          onClose={() => setShowNewMessageModal(false)}
          onConversationCreated={(conversation) => {
            setSelectedConversation(conversation)
            setShowContactPanel(true)
            setActiveConversation(conversation.id)
            setMobileView('chat')
            refetch()
          }}
        />
      )}
    </div>
  )
}
