'use client'

import { useState, useCallback, useRef, startTransition } from 'react'
import { getAvatarColor, getInitials } from '@/lib/avatar-color'

export default function ConversationList({
  conversations,
  loading,
  selectedConversation,
  onConversationSelect,
  formatPhoneNumber,
  onDeleteConversation,
  onMarkAsUnread,
  onMarkAsDone,
  onMarkAsOpen,
  onPinConversation,
  onBlockContact,
  callHook = null,
  isCreatingNew = false
}) {
  const [contextMenu, setContextMenu] = useState(null)
  const menuStateRef = useRef({ isOpen: false, conversation: null, position: null })

  const closeContextMenu = useCallback(() => {
    menuStateRef.current = { isOpen: false, conversation: null, position: null }
    setContextMenu(null)
  }, [])

  const handleContextMenu = useCallback((e, conversation) => {
    e.preventDefault()
    e.stopPropagation()

    // Update ref immediately (synchronous - no React delay)
    menuStateRef.current = {
      isOpen: true,
      conversation,
      position: { x: e.clientX, y: e.clientY }
    }

    // Then update state for React render
    setContextMenu({
      conversation,
      position: { x: e.clientX, y: e.clientY }
    })
  }, [])

  const handleCallClick = async (e, phoneNumber) => {
    e.stopPropagation()

    if (!callHook || !callHook.initiateCall || !callHook.selectedCallerNumber) {
      return
    }

    if (callHook.isCallActive) {
      return
    }

    try {
      await callHook.initiateCall(phoneNumber, callHook.selectedCallerNumber)
    } catch (error) {
      console.error('Error initiating call:', error)
    }
  }

  const handleCallFromContext = async () => {
    if (!contextMenu?.conversation || !callHook) return

    try {
      await handleCallClick({ stopPropagation: () => {} }, contextMenu.conversation.phone_number)
    } catch (error) {
      console.error('Error calling from context menu:', error)
    }
    closeContextMenu()
  }

  const handleDeleteConversation = () => {
    if (contextMenu?.conversation && onDeleteConversation) {
      onDeleteConversation(contextMenu.conversation.id)
    }
    closeContextMenu()
  }

  const handleMarkAsUnread = () => {
    if (contextMenu?.conversation && onMarkAsUnread) {
      onMarkAsUnread(contextMenu.conversation.id)
    }
    closeContextMenu()
  }

  const handleMarkAsDone = () => {
    if (contextMenu?.conversation && onMarkAsDone) {
      onMarkAsDone(contextMenu.conversation.id)
    }
    closeContextMenu()
  }

  const handleMarkAsOpen = () => {
    if (contextMenu?.conversation && onMarkAsOpen) {
      onMarkAsOpen(contextMenu.conversation.id)
    }
    closeContextMenu()
  }

  const handlePinConversation = () => {
    if (contextMenu?.conversation && onPinConversation) {
      onPinConversation(contextMenu.conversation.id)
    }
    closeContextMenu()
  }

  const handleBlockContact = () => {
    if (contextMenu?.conversation && onBlockContact) {
      onBlockContact(contextMenu.conversation.id, contextMenu.conversation.phone_number)
    }
    closeContextMenu()
  }

  const handleMoreClick = useCallback((e, conversation) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.min(rect.right - 180, window.innerWidth - 192)
    const position = { x, y: rect.bottom + 4 }
    menuStateRef.current = { isOpen: true, conversation, position }
    setContextMenu({ conversation, position })
  }, [])


  const formatTime = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    const now = new Date()
    const diffInMs = now - date
    const diffInMins = Math.floor(diffInMs / 60000)
    const diffInHours = Math.floor(diffInMs / 3600000)
    const diffInDays = Math.floor(diffInMs / 86400000)

    if (diffInMins < 1) return 'Just now'
    if (diffInMins < 60) return `${diffInMins}m`
    if (diffInHours < 24) return `${diffInHours}h`
    if (diffInDays < 7) return `${diffInDays}d`

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const truncateMessage = (text, maxLength = 50) => {
    if (!text) return ''
    return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
  }

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
            <div className="w-10 h-10 bg-gray-200 rounded-full flex-shrink-0"></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <div className="h-4 bg-gray-200 rounded w-32"></div>
                <div className="h-3 bg-gray-200 rounded w-10"></div>
              </div>
              <div className="h-3 bg-gray-200 rounded w-full max-w-[200px]"></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-900 mb-1">No conversations yet</p>
        <p className="text-xs text-gray-500">Start messaging to see conversations here</p>
      </div>
    )
  }

  return (
    <>
      {/* Click outside to close context menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={closeContextMenu}
          onContextMenu={(e) => {
            e.preventDefault()
            closeContextMenu()
          }}
        />
      )}

      <div>
        {/* New conversation row - shown when composing */}
        {isCreatingNew && (
          <div className="border-b border-gray-100">
            <div className="p-3 flex items-center gap-3">
              <div className="h-10 w-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-gray-900">New conversation</h3>
                <p className="text-sm text-gray-400 truncate">Send a message...</p>
              </div>
            </div>
          </div>
        )}

        {conversations.map((conversation) => {
          const isSelected = selectedConversation?.id === conversation.id
          const hasUnread = conversation.unreadCount > 0
          const displayName = conversation.name || formatPhoneNumber(conversation.phone_number)
          const initials = getInitials(displayName, conversation.phone_number)
          const isCurrentCall = callHook?.getCurrentCallNumber && callHook.getCurrentCallNumber() === conversation.phone_number
          const canCall = callHook && callHook.selectedCallerNumber && !callHook.isCallActive
          const isPinned = conversation.pinned

          return (
            <div
              key={conversation.id}
              onContextMenu={(e) => handleContextMenu(e, conversation)}
              onClick={() => {
                closeContextMenu()
                onConversationSelect(conversation)
              }}
              className={`cursor-pointer border-b border-gray-100 hover:bg-gray-50 transition-none ${
                isSelected ? 'bg-gray-50' : ''
              }`}
              style={{ willChange: 'background-color' }}
            >
              <div className="p-3 flex items-center gap-3">
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div
                    className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{ backgroundColor: getAvatarColor(conversation.phone_number) }}
                  >
                    {initials}
                  </div>

                  {/* Unread badge */}
                  {hasUnread && (
                    <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-[#C54A3F] rounded-full border-2 border-white flex items-center justify-center px-1">
                      <span className="text-[10px] font-bold text-white">
                        {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                      </span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isPinned && (
                        <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.707 10.708L16.293 9.294 16.293 4 17 4C17.553 4 18 3.552 18 3 18 2.448 17.553 2 17 2L7 2C6.447 2 6 2.448 6 3 6 3.552 6.447 4 7 4L7.707 4 7.707 9.294 6.293 10.708C6.105 10.896 6 11.151 6 11.415L6 13C6 13.552 6.447 14 7 14L11 14 11 21C11 21.552 11.447 22 12 22 12.553 22 13 21.552 13 21L13 14 17 14C17.553 14 18 13.552 18 13L18 11.415C18 11.151 17.895 10.896 17.707 10.708Z" />
                        </svg>
                      )}
                      <h3 className={`text-sm truncate ${hasUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                        {displayName}
                      </h3>
                    </div>

                    <span className="text-xs text-gray-500 flex-shrink-0">
                      {formatTime(conversation.lastMessage?.created_at)}
                    </span>
                  </div>
                  <p className={`text-sm truncate ${hasUnread ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                    {conversation.lastMessage?.direction === 'outbound' && 'You: '}
                    {truncateMessage(conversation.lastMessage?.body)}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Context Menu - Always rendered, just toggled with CSS for INSTANT display */}
      <div
        className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[180px]"
        style={{
          left: contextMenu ? `${contextMenu.position.x}px` : '-9999px',
          top: contextMenu ? `${contextMenu.position.y}px` : '-9999px',
          opacity: contextMenu ? 1 : 0,
          pointerEvents: contextMenu ? 'auto' : 'none',
          transition: 'none', // No transitions for instant display
        }}
        onClick={(e) => e.stopPropagation()}
      >
          {contextMenu && (
            <>
              {contextMenu.conversation.status === 'closed' ? (
                <button
                  onClick={handleMarkAsOpen}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 transition-none"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Mark as open
                </button>
              ) : (
                <button
                  onClick={handleMarkAsDone}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 transition-none"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Mark as done
                </button>
              )}

              <button
                onClick={handleMarkAsUnread}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 transition-none"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Mark as unread
              </button>

              <button
                onClick={handlePinConversation}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 transition-none"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                {contextMenu.conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
              </button>

              <div className="border-t border-gray-200 my-1"></div>

              <button
                onClick={handleBlockContact}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 transition-none"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                Block contact
              </button>

              <button
                onClick={handleDeleteConversation}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-none"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete conversation
              </button>
            </>
          )}
        </div>

    </>
  )
}
