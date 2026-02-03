// components/inbox/ChatWindow.js - Modern SaaS redesign with mobile optimization
'use client'

import { useState, useRef, useEffect } from 'react'
import MessageBubble from '../ui/message-bubble'
import CallInterface from '../calling/CallInterface'
import { PhoneNumberSelector } from '../calling/PhoneNumberSelector'
import { apiPost } from '@/lib/api-client'

export default function ChatWindow({
  conversation,
  messages,
  loading,
  phoneNumber,
  formatPhoneNumber,
  addOptimisticMessage,
  replaceOptimisticMessage,
  removeOptimisticMessage,
  onRefreshConversations,
  user,
  // Call-related props
  callHook,
  onInitiateCall,
  // Mobile props
  onBackToList,
  mobileView,
  // Action handlers
  onMarkAsUnread,
  onMarkAsDone
}) {
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [showPhoneSelector, setShowPhoneSelector] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const textareaRef = useRef(null)

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

  // NEW: Auto-select the correct caller number when conversation OR messages change
  useEffect(() => {
    if (conversation && callHook && callHook.availablePhoneNumbers.length > 0 && messages.length > 0) {
      // Find the number that matches the conversation's receiving number
      const matchingNumber = findMatchingCallerNumber()
      
      if (matchingNumber && matchingNumber !== callHook.selectedCallerNumber) {
        console.log(`Auto-selecting caller number: ${matchingNumber} for conversation with ${conversation.phone_number}`)
        console.log(`Available numbers:`, callHook.availablePhoneNumbers.map(n => n.phoneNumber))
        console.log(`Messages analysis:`, {
          totalMessages: messages.length,
          inboundCount: messages.filter(m => m.direction === 'inbound').length,
          outboundCount: messages.filter(m => m.direction === 'outbound').length,
          latestInbound: messages.filter(m => m.direction === 'inbound')[0]?.to_number,
          latestOutbound: messages.filter(m => m.direction === 'outbound')[0]?.from_number
        })
        callHook.setSelectedCallerNumber(matchingNumber)
      }
    }
  }, [conversation, callHook?.availablePhoneNumbers, messages]) // Added messages dependency

  // NEW: Helper function to find the correct caller number
  const findMatchingCallerNumber = () => {
    if (!conversation || !callHook?.availablePhoneNumbers || !messages.length) {
      console.log('No data for caller number selection')
      return callHook?.selectedCallerNumber || callHook?.availablePhoneNumbers?.[0]?.phoneNumber
    }
    
    // Sort messages by date (newest first)
    const sortedMessages = [...messages].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    
    console.log('Finding matching caller number for conversation:', conversation.phone_number)
    console.log('Available numbers:', callHook.availablePhoneNumbers.map(n => n.phoneNumber))
    
    // Look through messages to find which number received/sent messages in this conversation
    const inboundMessages = sortedMessages.filter(msg => msg.direction === 'inbound')
    const outboundMessages = sortedMessages.filter(msg => msg.direction === 'outbound')
    
    console.log('Message analysis:', {
      total: messages.length,
      inbound: inboundMessages.length,
      outbound: outboundMessages.length
    })
    
    // Priority 1: Use the number that received the most recent inbound message
    if (inboundMessages.length > 0) {
      const latestInbound = inboundMessages[0] // Most recent
      const receivingNumber = latestInbound.to_number
      console.log('Latest inbound message to:', receivingNumber)
      
      const matchingPhone = callHook.availablePhoneNumbers.find(phone => 
        normalizePhoneNumber(phone.phoneNumber) === normalizePhoneNumber(receivingNumber)
      )
      
      if (matchingPhone) {
        console.log(`✓ Found matching number from inbound message: ${matchingPhone.phoneNumber}`)
        return matchingPhone.phoneNumber
      }
    }
    
    // Priority 2: Use the number that sent the most recent outbound message
    if (outboundMessages.length > 0) {
      const latestOutbound = outboundMessages[0] // Most recent
      const sendingNumber = latestOutbound.from_number
      console.log('Latest outbound message from:', sendingNumber)
      
      const matchingPhone = callHook.availablePhoneNumbers.find(phone => 
        normalizePhoneNumber(phone.phoneNumber) === normalizePhoneNumber(sendingNumber)
      )
      
      if (matchingPhone) {
        console.log(`✓ Found matching number from outbound message: ${matchingPhone.phoneNumber}`)
        return matchingPhone.phoneNumber
      }
    }
    
    // Priority 3: Use the currently selected phoneNumber from props (if it's voice-capable)
    if (phoneNumber) {
      const matchingPhone = callHook.availablePhoneNumbers.find(phone => 
        normalizePhoneNumber(phone.phoneNumber) === normalizePhoneNumber(phoneNumber.phoneNumber)
      )
      
      if (matchingPhone) {
        console.log(`✓ Using current selected number: ${matchingPhone.phoneNumber}`)
        return matchingPhone.phoneNumber
      }
    }
    
    // Fallback: Keep current selection or use first available
    const fallback = callHook.selectedCallerNumber || callHook.availablePhoneNumbers[0]?.phoneNumber
    console.log(`Using fallback number: ${fallback}`)
    return fallback
  }

  // NEW: Helper function to normalize phone numbers for comparison
  const normalizePhoneNumber = (phone) => {
    if (!phone) return ''
    const digits = phone.replace(/\D/g, '')
    return digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
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
      await callHook.initiateCall(conversation.phone_number, correctCallerNumber)
    } catch (error) {
      console.error('Error initiating call:', error)
      alert(error.message || 'Failed to initiate call')
    }
  }

  const displayName = conversation.name || formatPhoneNumber(conversation.phone_number)
  const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  const isOnCall = callHook?.getCurrentCallNumber && callHook.getCurrentCallNumber() === conversation.phone_number

  return (
    <div className="flex h-full bg-white">
      {/* Main Chat Area */}
      <div className="flex flex-col flex-1 relative">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              {/* Left: Back button (mobile) + Avatar + Info */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Mobile Back Button */}
                {onBackToList && (
                  <button
                    onClick={onBackToList}
                    className="md:hidden p-2 -ml-2 text-gray-600 hover:text-gray-900"
                    aria-label="Back to conversations"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}

                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                    {initials}
                  </div>
                </div>

                {/* Contact Info */}
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-gray-900 truncate">
                    {displayName}
                  </h2>
                  <p className="text-sm text-gray-500 truncate">
                    {conversation.phone_number}
                  </p>
                </div>
              </div>

              {/* Right: Action Buttons */}
              <div className="flex items-center gap-1">
                {/* Call Button */}
                <button
                  onClick={handleCallClick}
                  disabled={callHook?.isCallActive && !isOnCall}
                  className="p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-none disabled:opacity-50"
                  title="Call"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </button>

                {/* Mark as Done (Checkmark in Circle) */}
                <button
                  onClick={() => onMarkAsDone && onMarkAsDone(conversation.id)}
                  className="p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-none"
                  title="Mark as done"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>

                {/* Mark as Unread (Circle Dot - cleaner icon) */}
                <button
                  onClick={() => onMarkAsUnread && onMarkAsUnread(conversation.id)}
                  className="p-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-none"
                  title="Mark as unread"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" strokeWidth={2} />
                    <circle cx="12" cy="12" r="4" fill="currentColor" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Desktop: Phone Number Selector - Always visible */}
            {callHook?.availablePhoneNumbers?.length > 0 && (
              <div className={`${showPhoneSelector ? 'block' : 'hidden md:block'} mt-3 pt-3 border-t border-gray-100 transition-all duration-300`}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Calling from
                  </label>
                  {findMatchingCallerNumber() !== callHook.selectedCallerNumber && (
                    <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                      Auto-selected
                    </span>
                  )}
                </div>
                <PhoneNumberSelector
                  availableNumbers={callHook.availablePhoneNumbers}
                  selectedNumber={callHook.selectedCallerNumber}
                  onNumberSelect={callHook.setSelectedCallerNumber}
                  isCallActive={callHook.isCallActive}
                  formatPhoneNumber={formatPhoneNumber}
                />
              </div>
            )}
          </div>
        </div>

        {/* Messages Area - Instant like OpenPhone, NO loading or empty state */}
        <div className="flex-1 overflow-y-auto bg-white">
          <div className="p-4 space-y-2">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} user={user} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="bg-white border-t border-gray-200 sticky bottom-0 z-10">
          <div className="p-4">
            <form onSubmit={sendMessage} className="flex items-center gap-2">
              <textarea
                ref={textareaRef}
                rows={1}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                onInput={handleTextareaInput}
                placeholder="Type a message..."
                disabled={sending || !phoneNumber}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:border-gray-400 text-sm"
                style={{
                  height: 'auto',
                  minHeight: '36px',
                  maxHeight: '120px',
                }}
              />

              <button
                type="submit"
                disabled={!newMessage.trim() || sending || !phoneNumber}
                className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                {sending ? (
                  <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
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
          background: #d1d5db;
          border-radius: 3px;
        }

        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
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