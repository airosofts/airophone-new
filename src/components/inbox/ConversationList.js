'use client'

import { useState, useCallback, useRef } from 'react'
import { getAvatarColor, getInitials } from '@/lib/avatar-color'

export default function ConversationList({
  conversations,
  loading,
  selectedConversation,
  onConversationSelect,
  formatPhoneNumber,
  onDeleteConversation,
  onMarkAsRead,
  onMarkAsUnread,
  onMarkAsDone,
  onMarkAsOpen,
  onPinConversation,
  onBlockContact,
  onAssignScenario,
  callHook = null,
  isCreatingNew = false
}) {
  const [contextMenu, setContextMenu] = useState(null)
  const menuStateRef = useRef({ isOpen: false, conversation: null, position: null })
  const [hoveredConv, setHoveredConv] = useState(null)
  const [hoverRect, setHoverRect] = useState(null)
  const actionBarRef = useRef(null)
  const hoverClearTimer = useRef(null)

  const clearHover = () => {
    hoverClearTimer.current = setTimeout(() => {
      setHoveredConv(null)
      setHoverRect(null)
    }, 150)
  }

  const cancelClearHover = () => {
    if (hoverClearTimer.current) {
      clearTimeout(hoverClearTimer.current)
      hoverClearTimer.current = null
    }
  }

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

  const handleAssignScenario = () => {
    if (contextMenu?.conversation && onAssignScenario) {
      onAssignScenario(contextMenu.conversation.id, contextMenu.conversation.phone_number)
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
          const displayName = (conversation.contact_first_name || conversation.contact_last_name)
            ? [conversation.contact_first_name, conversation.contact_last_name].filter(Boolean).join(' ')
            : (conversation.name || formatPhoneNumber(conversation.phone_number))
          const initials = getInitials(displayName, conversation.phone_number)
          const isPinned = conversation.pinned

          return (
            <div
              key={conversation.id}
              onContextMenu={(e) => handleContextMenu(e, conversation)}
              onClick={() => {
                closeContextMenu()
                onConversationSelect(conversation)
              }}
              onMouseEnter={(e) => {
                cancelClearHover()
                const rect = e.currentTarget.getBoundingClientRect()
                setHoveredConv(conversation)
                setHoverRect(rect)
              }}
              onMouseLeave={() => {
                clearHover()
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

      {/* Fixed-position hover action bar - renders outside scroll container */}
      {hoveredConv && hoverRect && (
        <div
          ref={actionBarRef}
          style={{
            position: 'fixed',
            top: hoverRect.top + hoverRect.height / 2,
            left: hoverRect.right - 8,
            transform: 'translateY(-50%)',
            zIndex: 60,
          }}
          onMouseEnter={() => {
            cancelClearHover()
          }}
          onMouseLeave={() => {
            setHoveredConv(null)
            setHoverRect(null)
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg shadow-lg px-1 py-1">
            {/* Call button */}
            {callHook && callHook.selectedCallerNumber && (
              <button
                title={callHook.isCallActive ? 'Call in progress' : 'Call'}
                disabled={callHook.isCallActive}
                onClick={(e) => handleCallClick(e, hoveredConv.phone_number)}
                className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
                </svg>
              </button>
            )}

            {/* Mark as done / open */}
            <button
              title={hoveredConv.status === 'closed' ? 'Mark as open' : 'Mark as done'}
              onClick={(e) => {
                e.stopPropagation()
                if (hoveredConv.status === 'closed') {
                  onMarkAsOpen?.(hoveredConv.id)
                } else {
                  onMarkAsDone?.(hoveredConv.id)
                }
              }}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>

            {/* Mark as read / unread */}
            <button
              title={hoveredConv.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}
              onClick={(e) => {
                e.stopPropagation()
                if (hoveredConv.unreadCount > 0) {
                  onMarkAsRead?.(hoveredConv.id)
                } else {
                  onMarkAsUnread?.(hoveredConv.id)
                }
              }}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8.33333333,1.875 C8.6785113,1.875 8.95833333,2.15482203 8.95833333,2.5 C8.95833333,2.81379815 8.72707546,3.07358314 8.42569125,3.1182234 L8.33333333,3.125 L4.99999978,3.125 C4.01378052,3.125 3.20539387,3.88642392 3.13064099,4.85347034 L3.12499978,5 L3.12499978,15 C3.12499978,15.9862194 3.88642349,16.7946059 4.85347009,16.8693588 L4.99999978,16.875 L14.9999998,16.875 C15.9862192,16.875 16.7946057,16.1135763 16.8693586,15.1465297 L16.8749998,15 L16.8749998,11.6666667 C16.8749998,11.3214887 17.1548218,11.0416667 17.4999998,11.0416667 C17.8137979,11.0416667 18.0735829,11.2729245 18.1182232,11.5743087 L18.1249998,11.6666667 L18.1249998,15 C18.1249998,16.666373 16.8207131,18.0281208 15.1773301,18.1200531 L14.9999998,18.125 L4.99999978,18.125 C3.3336268,18.125 1.97187893,16.8207133 1.87994671,15.1773303 L1.87499978,15 L1.87499978,5 C1.87499978,3.33362727 3.17928662,1.97187917 4.82266946,1.87994693 L4.99999978,1.875 L8.33333333,1.875 Z M14.375,1.875 C16.4460678,1.875 18.125,3.55393219 18.125,5.625 C18.125,7.69606781 16.4460678,9.375 14.375,9.375 C12.3039322,9.375 10.625,7.69606781 10.625,5.625 C10.625,3.55393219 12.3039322,1.875 14.375,1.875 Z M14.375,3.125 C12.9942881,3.125 11.875,4.24428813 11.875,5.625 C11.875,7.00571187 12.9942881,8.125 14.375,8.125 C15.7557119,8.125 16.875,7.00571187 16.875,5.625 C16.875,4.24428813 15.7557119,3.125 14.375,3.125 Z" />
              </svg>
            </button>

            {/* More (opens context menu) */}
            <button
              title="More actions"
              onClick={(e) => {
                e.stopPropagation()
                handleMoreClick(e, hoveredConv)
                setHoveredConv(null)
                setHoverRect(null)
              }}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
              </svg>
            </button>
          </div>
        </div>
      )}

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

              {onAssignScenario && (
                <button
                  onClick={handleAssignScenario}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 transition-none"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
                  </svg>
                  Assign scenario
                </button>
              )}

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
