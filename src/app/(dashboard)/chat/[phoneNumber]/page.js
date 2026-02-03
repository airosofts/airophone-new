'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { useRealtimeMessages } from '@/hooks/useRealtime'
import MessageBubble from '@/components/ui/message-bubble'
import Loading from '@/components/ui/loading'

export default function ChatPage({ params }) {
  const { phoneNumber } = params
  const decodedPhoneNumber = decodeURIComponent(phoneNumber)
  const searchParams = useSearchParams()
  const fromParam = searchParams.get('from')
  
  const [conversationId, setConversationId] = useState(null)
  const [conversationLoading, setConversationLoading] = useState(true)
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [selectedFromNumber, setSelectedFromNumber] = useState(fromParam || '')
  const [user, setUser] = useState(null)
  const messagesEndRef = useRef(null)

  const { messages, loading: messagesLoading, addOptimisticMessage, replaceOptimisticMessage, removeOptimisticMessage } = useRealtimeMessages(conversationId)

  useEffect(() => {
    const currentUser = getCurrentUser()
    if (!currentUser) {
      window.location.href = '/login'
      return
    }
    setUser(currentUser)
    
    const fetchData = async () => {
      try {
        const response = await fetch('/api/phone-numbers')
        const data = await response.json()
        if (data.success && data.phoneNumbers.length > 0) {
          setPhoneNumbers(data.phoneNumbers)
          if (!selectedFromNumber) {
            setSelectedFromNumber(data.phoneNumbers[0].phoneNumber)
          }
        }
      } catch (error) {
        console.error('Error fetching phone numbers:', error)
      }
    }
    
    fetchData()
  }, [selectedFromNumber])

  useEffect(() => {
    if (phoneNumbers.length > 0) {
      const getConversation = async () => {
        try {
          setConversationLoading(true)
          
          const response = await fetch('/api/conversations/find', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone_number: decodedPhoneNumber,
              from_number: selectedFromNumber
            })
          })

          const data = await response.json()
          
          if (data.success && data.conversation) {
            setConversationId(data.conversation.id)
          }
        } catch (error) {
          console.error('Error getting conversation:', error)
        } finally {
          setConversationLoading(false)
        }
      }
      
      getConversation()
    }
  }, [decodedPhoneNumber, phoneNumbers, selectedFromNumber])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits
    
    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }

  const sendMessage = async (messageText) => {
    if (!messageText.trim() || !selectedFromNumber) {
      return { success: false, error: 'Message and phone number required' }
    }

    const optimisticId = addOptimisticMessage({
      conversation_id: conversationId,
      direction: 'outbound',
      from_number: selectedFromNumber,
      to_number: decodedPhoneNumber,
      body: messageText,
      status: 'sending',
      sent_by: user.userId
    })

    try {
      const response = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: selectedFromNumber,
          to: decodedPhoneNumber,
          message: messageText,
          conversationId: conversationId
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send message')
      }

      if (result.message) {
        replaceOptimisticMessage(optimisticId, result.message)
      }

      if (!conversationId && result.conversation) {
        setConversationId(result.conversation.id)
      }

      return { success: true }

    } catch (error) {
      console.error('Error sending message:', error)
      removeOptimisticMessage(optimisticId)
      return { success: false, error: error.message }
    }
  }

  if (conversationLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loading />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-10">
        <div className="flex items-center justify-between p-4">
          <Link href="/inbox" className="flex items-center text-primary hover:text-primary-hover">
            <svg className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Link>
          <h1 className="font-medium text-gray-900">
            {formatPhoneNumber(decodedPhoneNumber)}
          </h1>
          <div className="w-12"></div>
        </div>
      </div>

      <div className="hidden lg:block w-80 bg-white shadow-sm border-r border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <Link href="/inbox" className="inline-flex items-center text-sm text-primary hover:text-primary-hover mb-3">
            <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Inbox
          </Link>
          <h1 className="text-xl font-semibold text-gray-900 mb-4">
            {formatPhoneNumber(decodedPhoneNumber)}
          </h1>

          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">Send From</label>
            <select
              value={selectedFromNumber}
              onChange={(e) => setSelectedFromNumber(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-primary"
            >
              <option value="">Select number</option>
              {phoneNumbers.map(phone => (
                <option key={phone.id} value={phone.phoneNumber}>
                  {phone.custom_name ? `${phone.custom_name} - ${formatPhoneNumber(phone.phoneNumber)}` : formatPhoneNumber(phone.phoneNumber)}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="p-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Chat Info</h3>
            <div className="text-sm text-gray-600 space-y-1">
              <p>To: {decodedPhoneNumber}</p>
              <p>From: {selectedFromNumber ? formatPhoneNumber(selectedFromNumber) : 'Select number'}</p>
              <p>Messages: {messages.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {formatPhoneNumber(decodedPhoneNumber)}
              </h2>
              <p className="text-sm text-gray-500">
                {messages.length} messages • From: {formatPhoneNumber(selectedFromNumber) || 'Select number'}
              </p>
            </div>
            <div className="flex items-center text-sm text-gray-500">
              <div className="h-2 w-2 bg-green-400 rounded-full mr-2"></div>
              Real-time
            </div>
          </div>
        </div>

        <div className="lg:hidden bg-white border-b border-gray-200 p-4 pt-20">
          <label className="block text-xs font-medium text-gray-700 mb-1">Send From</label>
          <select
            value={selectedFromNumber}
            onChange={(e) => setSelectedFromNumber(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-primary"
          >
            <option value="">Select number</option>
            {phoneNumbers.map(phone => (
              <option key={phone.id} value={phone.phoneNumber}>
                {phone.custom_name ? `${phone.custom_name} - ${formatPhoneNumber(phone.phoneNumber)}` : formatPhoneNumber(phone.phoneNumber)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          {messagesLoading ? (
            <div className="flex justify-center items-center h-64">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-gray-500">No messages yet</p>
              <p className="text-sm text-gray-400 mt-1">Start the conversation below</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => (
                <MessageBubble key={message.id || `msg-${index}`} message={message} user={user} />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <MessageInput 
          onSendMessage={sendMessage}
          phoneNumber={selectedFromNumber}
          formatPhoneNumber={formatPhoneNumber}
        />
      </div>
    </div>
  )
}

function MessageInput({ onSendMessage, phoneNumber, formatPhoneNumber }) {
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!newMessage.trim() || sending || !phoneNumber) {
      return
    }

    setSending(true)
    const messageText = newMessage.trim()
    
    try {
      const result = await onSendMessage(messageText)
      
      if (result.success) {
        setNewMessage('')
      } else {
        alert(`Failed to send: ${result.error}`)
      }
    } catch (error) {
      alert(`Error: ${error.message}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white border-t border-gray-200 p-4">
      {!phoneNumber && (
        <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">Select a phone number to send from</p>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="flex space-x-3">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder={phoneNumber ? "Type your message..." : "Select a number first..."}
          disabled={sending || !phoneNumber}
          className={`flex-1 px-4 py-3 border border-gray-300 rounded-xl focus-primary ${
            !phoneNumber ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
          }`}
        />
        <button
          type="submit"
          disabled={!newMessage.trim() || sending || !phoneNumber}
          className={`px-6 py-3 rounded-xl font-medium transition-colors flex items-center space-x-2 ${
            newMessage.trim() && !sending && phoneNumber
              ? 'bg-primary hover:bg-primary-hover text-white'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {sending ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Sending</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              <span>Send</span>
            </>
          )}
        </button>
      </form>
    </div>
  )
}