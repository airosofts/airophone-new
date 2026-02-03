// src/components/ui/conversation-item.js - Updated for OpenPhone style with better UX
'use client'

import { useState, useEffect } from 'react'

export default function ConversationItem({ 
  conversation, 
  formatPhoneNumber, 
  isSelected = false,
  onClick 
}) {
  const [lastMessage, setLastMessage] = useState(null)

  useEffect(() => {
    if (conversation.lastMessage) {
      setLastMessage(conversation.lastMessage)
    }
  }, [conversation])

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return ''
    
    const date = new Date(timestamp)
    const now = new Date()
    const diffTime = Math.abs(now - date)
    const diffHours = Math.ceil(diffTime / (1000 * 60 * 60))
    
    if (diffHours < 1) {
      return 'now'
    } else if (diffHours < 24) {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      })
    } else if (diffHours < 48) {
      return 'Yesterday'
    } else if (diffHours < 168) {
      return date.toLocaleDateString('en-US', { weekday: 'short' })
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      })
    }
  }

  const truncateMessage = (text, maxLength = 45) => {
    if (!text) return 'No messages yet'
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  }

  const getInitials = (phoneNumber) => {
    if (!phoneNumber) return '??'
    const digits = phoneNumber.replace(/\D/g, '')
    const lastFour = digits.slice(-4)
    return lastFour.slice(0, 2).toUpperCase()
  }

  const getDisplayName = (conversation) => {
    if (conversation.name) {
      return conversation.name
    }
    return formatPhoneNumber(conversation.phone_number)
  }

  const isUnread = () => {
    return lastMessage?.direction === 'inbound' && !lastMessage?.read_at
  }

  const getMessagePreview = () => {
    if (!lastMessage) return 'No messages yet'
    
    const prefix = lastMessage.direction === 'outbound' ? 'You: ' : ''
    return prefix + truncateMessage(lastMessage.body, 40)
  }

  const getStatusIcon = (message) => {
    if (!message || message.direction === 'inbound') return null

    switch (message.status) {
      case 'sending':
        return (
          <svg className="h-3 w-3 text-gray-400 animate-pulse ml-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        )
      case 'sent':
        return (
          <svg className="h-3 w-3 text-gray-400 ml-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )
      case 'delivered':
        return (
          <div className="flex ml-1 flex-shrink-0">
            <svg className="h-3 w-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <svg className="h-3 w-3 text-green-500 -ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )
      case 'failed':
        return (
          <svg className="h-3 w-3 text-red-500 ml-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )
      default:
        return null
    }
  }

  return (
    <div 
      className={`group hover:bg-gray-50 transition-colors cursor-pointer border-l-4 ${
        isSelected 
          ? 'bg-blue-50 border-blue-500' 
          : 'border-transparent hover:border-gray-200'
      }`}
      onClick={onClick}
    >
      <div className="p-3">
        <div className="flex items-center space-x-3">
          {/* Avatar */}
          <div className="flex-shrink-0">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-medium transition-colors ${
              isSelected ? 'bg-blue-600' : 'bg-gradient-to-br from-blue-500 to-purple-600'
            }`}>
              {getInitials(conversation.phone_number)}
            </div>
          </div>

          {/* Conversation Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                <h3 className={`text-sm font-medium truncate ${
                  isUnread() ? 'text-gray-900 font-semibold' : 'text-gray-700'
                }`}>
                  {getDisplayName(conversation)}
                </h3>
                {isUnread() && (
                  <div className="h-2 w-2 bg-blue-600 rounded-full flex-shrink-0"></div>
                )}
                {conversation.unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-blue-600 rounded-full flex-shrink-0">
                    {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-1 flex-shrink-0">
                <span className="text-xs text-gray-500">
                  {formatTimestamp(conversation.last_message_at)}
                </span>
                {getStatusIcon(lastMessage)}
              </div>
            </div>

            {/* Last Message Preview */}
            <div className="mt-1">
              <div className="flex items-start">
                <p className={`text-sm truncate flex-1 ${
                  isUnread() ? 'text-gray-900 font-medium' : 'text-gray-600'
                }`}>
                  {getMessagePreview()}
                </p>
              </div>
              
              {/* Message status for failed messages */}
              {lastMessage?.status === 'failed' && lastMessage?.direction === 'outbound' && (
                <div className="flex items-center mt-1">
                  <svg className="h-3 w-3 text-red-500 mr-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span className="text-xs text-red-600">Failed to send</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}