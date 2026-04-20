// components/inbox/ChatWindow.js - Modern SaaS redesign with mobile optimization
'use client'

import { useState, useRef, useEffect } from 'react'
import MessageBubble from '../ui/message-bubble'
import CallBubble from '../ui/call-bubble'
import CallInterface from '../calling/CallInterface'
import { apiPost } from '@/lib/api-client'
import { getAvatarColor, getInitials } from '@/lib/avatar-color'

export default function ChatWindow({
  conversation,
  messages,
  phoneNumber,
  formatPhoneNumber,
  addOptimisticMessage,
  replaceOptimisticMessage,
  removeOptimisticMessage,
  onRefreshConversations,
  user,
  // Call-related props
  callHook,
  // Mobile props
  onBackToList,
  // Action handlers
  onMarkAsRead,
  onMarkAsUnread,
  onMarkAsDone,
  onMarkAsOpen,
  onPinConversation,
  onBlockContact,
  onDeleteConversation,
  onAssignScenario
}) {
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const moreMenuRef = useRef(null)

  // Close more menu when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setShowMoreMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Focus input and reset textarea height when conversation changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.style.height = '44px'
    }
  }, [conversation])

  // Auto-select the correct caller number when conversation changes
  useEffect(() => {
    if (conversation && callHook) {
      const correctNumber = findMatchingCallerNumber()
      if (correctNumber && correctNumber !== callHook.selectedCallerNumber) {
        callHook.setSelectedCallerNumber(correctNumber)
      }
    }
  }, [conversation?.id])

  // Helper function to find the correct caller number
  const findMatchingCallerNumber = () => {
    // Priority 1: Use the conversation's own line (from_number is our number for this convo)
    if (conversation?.from_number) {
      return conversation.from_number
    }

    // Priority 2: Use the currently selected phone line from sidebar
    if (phoneNumber?.phoneNumber) {
      return phoneNumber.phoneNumber
    }

    // Priority 3: Try from messages
    const msgItems = messages.filter(m => m._type !== 'call')
    if (msgItems.length > 0) {
      const sorted = [...msgItems].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      const outbound = sorted.find(m => m.direction === 'outbound')
      if (outbound?.from_number) return outbound.from_number
      const inbound = sorted.find(m => m.direction === 'inbound')
      if (inbound?.to_number) return inbound.to_number
    }

    // Fallback
    return callHook?.selectedCallerNumber || callHook?.availablePhoneNumbers?.[0]?.phoneNumber
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const sendMessage = async (e) => {
    e.preventDefault()
    
    if (!newMessage.trim() || sending || !phoneNumber) {
      return
    }

    setSending(true)
    const messageText = newMessage.trim()
    setNewMessage('')

    const optimisticId = addOptimisticMessage({
      conversation_id: conversation.id,
      direction: 'outbound',
      from_number: phoneNumber.phoneNumber,
      to_number: conversation.phone_number,
      body: messageText,
      status: 'sending',
      sent_by: user.userId
    })

    try {
      const response = await apiPost('/api/sms/send', {
        from: phoneNumber.phoneNumber,
        to: conversation.phone_number,
        message: messageText,
        conversationId: conversation.id,
        userId: user.userId
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || result.message || 'Failed to send message')
      }

      if (result.message) {
        replaceOptimisticMessage(optimisticId, result.message)
      }

      onRefreshConversations()

    } catch (error) {
      console.error('Error sending message:', error)
      removeOptimisticMessage(optimisticId)
      setNewMessage(messageText)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    // Send message on Enter (mobile: also allow without Shift), allow new line with Shift+Enter (desktop)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(e)
    }
  }

  const handleTextareaInput = (e) => {
    // Auto-resize textarea
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(Math.max(e.target.scrollHeight, 44), 120)}px`
  }

  const handleCallClick = async () => {
    // Check WebRTC readiness first with helpful messages
    if (callHook.isInitializing) {
      alert('Phone system is still connecting. Please wait a few seconds and try again.')
      return
    }

    if (callHook.initError) {
      alert(`Phone system error: ${callHook.initError}`)
      return
    }

    if (!callHook.isRegistered) {
      alert('Phone system is not connected. Please refresh the page and try again.')
      return
    }

    // Auto-select the correct caller number before making the call
    const correctCallerNumber = findMatchingCallerNumber()

    if (!correctCallerNumber) {
      alert('No suitable phone number found for calling')
      return
    }

    if (callHook.isCallActive) {
      alert('A call is already in progress')
      return
    }

    try {
      console.log(`Initiating call to ${conversation.phone_number} from ${correctCallerNumber}`)
      await callHook.initiateCall(conversation.phone_number, correctCallerNumber, conversation.id)
    } catch (error) {
      console.error('Error initiating call:', error)
      alert(error.message || 'Failed to initiate call')
    }
  }

  const displayName = (conversation.contact_first_name || conversation.contact_last_name)
    ? [conversation.contact_first_name, conversation.contact_last_name].filter(Boolean).join(' ')
    : (conversation.name || formatPhoneNumber(conversation.phone_number))
  const initials = getInitials(displayName, conversation.phone_number)
  const isOnCall = callHook?.getCurrentCallNumber && callHook.getCurrentCallNumber() === conversation.phone_number
  const isWebRTCReady = callHook?.isRegistered && !callHook?.isInitializing

  return (
    <div className="flex h-full bg-[#FFFFFF]">
      {/* Main Chat Area */}
      <div className="flex flex-col flex-1 relative">
        {/* Header */}
        <div className="bg-[#FFFFFF] border-b border-[#E3E1DB] sticky top-0 z-10">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              {/* Left: Back button (mobile) + Avatar + Info */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Mobile Back Button */}
                {onBackToList && (
                  <button
                    onClick={onBackToList}
                    className="md:hidden p-2 -ml-2 text-[#5C5A55] hover:text-[#131210]"
                    aria-label="Back to conversations"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}

                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{ backgroundColor: getAvatarColor(conversation.phone_number) }}
                  >
                    {initials}
                  </div>
                </div>

                {/* Contact Info */}
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-[#131210] truncate">
                    {displayName}
                  </h2>
                  <p className="text-sm text-[#5C5A55] truncate">
                    {conversation.phone_number}
                  </p>
                </div>
              </div>

              {/* Right: Action Buttons */}
              <div className="flex items-center gap-0.5">
                {/* Call */}
                <button
                  onClick={handleCallClick}
                  disabled={(callHook?.isCallActive && !isOnCall) || !isWebRTCReady}
                  className={`relative p-2 rounded-lg transition-colors disabled:opacity-40 ${
                    isWebRTCReady
                      ? 'text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3]'
                      : 'text-[#D4D1C9] cursor-not-allowed'
                  }`}
                  title={
                    callHook?.isInitializing ? 'Connecting phone system...' :
                    callHook?.initError ? `Phone error: ${callHook.initError}` :
                    !callHook?.isRegistered ? 'Phone system not connected' :
                    'Call'
                  }
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
                  </svg>
                  {callHook?.isInitializing && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 border border-white rounded-full bg-[#f59e0b] animate-pulse" />
                  )}
                  {isWebRTCReady && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 border border-white rounded-full bg-[#22c55e]" />
                  )}
                  {!callHook?.isInitializing && !isWebRTCReady && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 border border-white rounded-full bg-[#D63B1F]" />
                  )}
                </button>

                {/* Done / Open toggle */}
                <button
                  onClick={() => {
                    if (conversation.status === 'closed') {
                      onMarkAsOpen?.(conversation.id)
                    } else {
                      onMarkAsDone?.(conversation.id)
                    }
                  }}
                  className="p-2 text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3] rounded-lg transition-colors"
                  title={conversation.status === 'closed' ? 'Mark as open' : 'Mark as done'}
                >
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>

                {/* Mark as unread */}
                <button
                  onClick={() => onMarkAsUnread?.(conversation.id)}
                  className="p-2 text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3] rounded-lg transition-colors"
                  title="Mark as unread"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8.33333333,1.875 C8.6785113,1.875 8.95833333,2.15482203 8.95833333,2.5 C8.95833333,2.81379815 8.72707546,3.07358314 8.42569125,3.1182234 L8.33333333,3.125 L4.99999978,3.125 C4.01378052,3.125 3.20539387,3.88642392 3.13064099,4.85347034 L3.12499978,5 L3.12499978,15 C3.12499978,15.9862194 3.88642349,16.7946059 4.85347009,16.8693588 L4.99999978,16.875 L14.9999998,16.875 C15.9862192,16.875 16.7946057,16.1135763 16.8693586,15.1465297 L16.8749998,15 L16.8749998,11.6666667 C16.8749998,11.3214887 17.1548218,11.0416667 17.4999998,11.0416667 C17.8137979,11.0416667 18.0735829,11.2729245 18.1182232,11.5743087 L18.1249998,11.6666667 L18.1249998,15 C18.1249998,16.666373 16.8207131,18.0281208 15.1773301,18.1200531 L14.9999998,18.125 L4.99999978,18.125 C3.3336268,18.125 1.97187893,16.8207133 1.87994671,15.1773303 L1.87499978,15 L1.87499978,5 C1.87499978,3.33362727 3.17928662,1.97187917 4.82266946,1.87994693 L4.99999978,1.875 L8.33333333,1.875 Z M14.375,1.875 C16.4460678,1.875 18.125,3.55393219 18.125,5.625 C18.125,7.69606781 16.4460678,9.375 14.375,9.375 C12.3039322,9.375 10.625,7.69606781 10.625,5.625 C10.625,3.55393219 12.3039322,1.875 14.375,1.875 Z M14.375,3.125 C12.9942881,3.125 11.875,4.24428813 11.875,5.625 C11.875,7.00571187 12.9942881,8.125 14.375,8.125 C15.7557119,8.125 16.875,7.00571187 16.875,5.625 C16.875,4.24428813 15.7557119,3.125 14.375,3.125 Z" />
                  </svg>
                </button>

                {/* More (three dots) */}
                <div className="relative" ref={moreMenuRef}>
                  <button
                    onClick={() => setShowMoreMenu(v => !v)}
                    className="p-2 text-[#5C5A55] hover:text-[#131210] hover:bg-[#F7F6F3] rounded-lg transition-colors"
                    title="More options"
                  >
                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="5" cy="12" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="19" cy="12" r="1.5" />
                    </svg>
                  </button>

                  {showMoreMenu && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-[#FFFFFF] rounded-lg shadow-lg border border-[#E3E1DB] py-1 z-50">
                      {onAssignScenario && (
                        <button
                          onClick={() => { onAssignScenario(conversation.id, conversation.phone_number); setShowMoreMenu(false) }}
                          className="w-full px-4 py-2.5 text-left text-sm text-[#5C5A55] hover:bg-[#F7F6F3] flex items-center gap-3"
                        >
                          <svg className="w-4 h-4 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2"/>
                            <path d="M8 21h8M12 17v4"/>
                          </svg>
                          Assign scenario
                        </button>
                      )}
                      <button
                        onClick={() => { onPinConversation?.(conversation.id); setShowMoreMenu(false) }}
                        className="w-full px-4 py-2.5 text-left text-sm text-[#5C5A55] hover:bg-[#F7F6F3] flex items-center gap-3"
                      >
                        <svg className="w-4 h-4 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                        </svg>
                        {conversation.pinned ? 'Unpin' : 'Pin'} conversation
                      </button>
                      <button
                        onClick={() => { onBlockContact?.(conversation.id, conversation.phone_number); setShowMoreMenu(false) }}
                        className="w-full px-4 py-2.5 text-left text-sm text-[#5C5A55] hover:bg-[#F7F6F3] flex items-center gap-3"
                      >
                        <svg className="w-4 h-4 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M4.93 4.93l14.14 14.14"/>
                        </svg>
                        Block contact
                      </button>
                      <div className="my-1 border-t border-[#E3E1DB]" />
                      <button
                        onClick={() => { onDeleteConversation?.(conversation.id); setShowMoreMenu(false) }}
                        className="w-full px-4 py-2.5 text-left text-sm text-[#D63B1F] hover:bg-[rgba(214,59,31,0.07)] flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                        Delete conversation
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Messages Area - Instant like OpenPhone, NO loading or empty state */}
        <div className="flex-1 overflow-y-auto bg-[#FFFFFF]">
          <div className="p-4 space-y-2">
            {messages.map((item) => (
              item._type === 'call'
                ? <CallBubble key={`call-${item.id}`} call={item} />
                : <MessageBubble key={item.id} message={item} user={user} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="bg-[#FFFFFF] border-t border-[#E3E1DB] sticky bottom-0 z-10">
          <div className="p-4">
            <form onSubmit={sendMessage} className="flex items-center gap-2">
              <textarea
                ref={textareaRef}
                rows={1}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onClick={() => onMarkAsRead?.(conversation.id)}
                onKeyDown={handleKeyDown}
                onInput={handleTextareaInput}
                placeholder="Type a message..."
                disabled={sending || !phoneNumber}
                className="flex-1 px-3 py-2 border border-[#D4D1C9] rounded-lg resize-none focus:outline-none focus:border-[#D4D1C9] text-sm"
                style={{
                  height: 'auto',
                  minHeight: '36px',
                  maxHeight: '120px',
                }}
              />

              <button
                type="submit"
                disabled={!newMessage.trim() || sending || !phoneNumber}
                className="p-2 text-[#5C5A55] hover:text-[#131210] disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                {sending ? (
                  <div className="w-5 h-5 border-2 border-[#D4D1C9] border-t-[#5C5A55] rounded-full animate-spin"></div>
                ) : (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Call Interface - Floating overlay */}
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
          callHook={callHook}
        />
      )}

      {/* Custom Animations */}
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        /* Smooth scrollbar styling */
        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
        }

        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }

        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: #D4D1C9;
          border-radius: 3px;
        }

        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: #9B9890;
        }

        /* Input focus ring animation */
        textarea:focus {
          outline: none;
        }

        /* Disable resize handle on mobile */
        @media (max-width: 640px) {
          textarea {
            resize: none !important;
          }
        }
      `}</style>
    </div>
  )
}