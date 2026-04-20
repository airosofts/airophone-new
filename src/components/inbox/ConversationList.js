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
    menuStateRef.current = {
      isOpen: true,
      conversation,
      position: { x: e.clientX, y: e.clientY }
    }
    setContextMenu({
      conversation,
      position: { x: e.clientX, y: e.clientY }
    })
  }, [])

  const handleCallClick = async (e, phoneNumber) => {
    e.stopPropagation()
    if (!callHook || !callHook.initiateCall || !callHook.selectedCallerNumber) return
    if (callHook.isCallActive) return
    try {
      await callHook.initiateCall(phoneNumber, callHook.selectedCallerNumber)
    } catch (error) {
      console.error('Error initiating call:', error)
    }
  }

  const handleDeleteConversation = () => {
    if (contextMenu?.conversation && onDeleteConversation) onDeleteConversation(contextMenu.conversation.id)
    closeContextMenu()
  }
  const handleMarkAsUnread = () => {
    if (contextMenu?.conversation && onMarkAsUnread) onMarkAsUnread(contextMenu.conversation.id)
    closeContextMenu()
  }
  const handleMarkAsDone = () => {
    if (contextMenu?.conversation && onMarkAsDone) onMarkAsDone(contextMenu.conversation.id)
    closeContextMenu()
  }
  const handleMarkAsOpen = () => {
    if (contextMenu?.conversation && onMarkAsOpen) onMarkAsOpen(contextMenu.conversation.id)
    closeContextMenu()
  }
  const handlePinConversation = () => {
    if (contextMenu?.conversation && onPinConversation) onPinConversation(contextMenu.conversation.id)
    closeContextMenu()
  }
  const handleBlockContact = () => {
    if (contextMenu?.conversation && onBlockContact) onBlockContact(contextMenu.conversation.id, contextMenu.conversation.phone_number)
    closeContextMenu()
  }
  const handleAssignScenario = () => {
    if (contextMenu?.conversation && onAssignScenario) onAssignScenario(contextMenu.conversation.id, contextMenu.conversation.phone_number)
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

  // Returns the most recent activity timestamp (message or call)
  const getLastActivityTime = (conv) => {
    const mt = conv.lastMessage?.created_at
    const ct = conv.lastCall?.created_at
    if (!mt && !ct) return null
    if (!mt) return ct
    if (!ct) return mt
    return mt > ct ? mt : ct
  }

  // Returns call snippet label + color when call is the most recent event
  const getCallSnippet = (conv) => {
    const { lastMessage, lastCall } = conv
    if (!lastCall) return null
    if (lastMessage && lastMessage.created_at >= lastCall.created_at) return null
    const { direction, status } = lastCall
    const isMissed = status === 'missed' || status === 'no-answer' || status === 'busy'
    if (direction === 'inbound' && isMissed) return { label: 'Missed call', arrow: '↙', color: '#D63B1F' }
    if (direction === 'outbound' && isMissed) return { label: 'Missed your call', arrow: '↗', color: '#9B9890' }
    if (direction === 'inbound') return { label: 'Incoming call', arrow: '↙', color: '#9B9890' }
    return { label: 'Outgoing call', arrow: '↗', color: '#9B9890' }
  }

  // ── Skeleton loader ──
  if (loading) {
    return (
      <div style={{ padding: 4 }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="animate-pulse" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#EFEDE8', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ height: 12, background: '#EFEDE8', borderRadius: 4, width: 120 }} />
                <div style={{ height: 10, background: '#EFEDE8', borderRadius: 4, width: 28 }} />
              </div>
              <div style={{ height: 10, background: '#EFEDE8', borderRadius: 4, width: '80%' }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Empty state ──
  if (conversations.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 13,
          background: '#EFEDE8', border: '1px solid #E3E1DB',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.5">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            <path d="M8 10h.01M12 10h.01M16 10h.01"/>
          </svg>
        </div>
        <p style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: '#131210', marginBottom: 4 }}>No conversations yet</p>
        <p style={{ fontSize: '12.5px', color: '#9B9890' }}>Start messaging to see conversations here</p>
      </div>
    )
  }

  // ── Shared styles ──
  const menuItemStyle = {
    width: '100%', padding: '8px 14px', textAlign: 'left',
    fontSize: 13, border: 'none', cursor: 'pointer',
    background: 'transparent', color: '#5C5A55',
    display: 'flex', alignItems: 'center', gap: 9,
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    transition: 'none',
  }

  return (
    <>
      {/* Click outside to close context menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={closeContextMenu}
          onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }}
        />
      )}

      <div>
        {/* New conversation row */}
        {isCreatingNew && (
          <div style={{ borderBottom: '1px solid #E3E1DB' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: '#EFEDE8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', fontWeight: 500, color: '#131210' }}>New conversation</div>
                <div style={{ fontSize: '11.5px', color: '#9B9890' }}>Send a message...</div>
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

          const callSnippet = getCallSnippet(conversation)
          const activityTime = getLastActivityTime(conversation)

          return (
            <div
              key={conversation.id}
              onContextMenu={(e) => handleContextMenu(e, conversation)}
              onClick={() => { closeContextMenu(); onConversationSelect(conversation) }}
              onMouseEnter={(e) => {
                cancelClearHover()
                const rect = e.currentTarget.getBoundingClientRect()
                setHoveredConv(conversation)
                setHoverRect(rect)
                e.currentTarget.style.background = '#F7F6F3'
              }}
              onMouseLeave={(e) => {
                clearHover()
                e.currentTarget.style.background = isSelected ? '#F7F6F3' : 'transparent'
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '11px 14px',
                borderBottom: '1px solid #E3E1DB',
                cursor: 'pointer',
                background: isSelected ? '#F7F6F3' : 'transparent',
                transition: 'background 0.12s',
                willChange: 'background-color',
              }}
            >
              {/* Avatar */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 11, fontWeight: 600,
                  backgroundColor: getAvatarColor(conversation.phone_number),
                }}>
                  {initials}
                </div>
                {hasUnread && (
                  <div style={{
                    position: 'absolute', top: -3, right: -3,
                    minWidth: 16, height: 16, borderRadius: '50%',
                    background: '#D63B1F', border: '2px solid #FFFFFF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px',
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>
                      {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                    </span>
                  </div>
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    {isPinned && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="#9B9890" style={{ flexShrink: 0 }}>
                        <path d="M17.707 10.708L16.293 9.294 16.293 4 17 4C17.553 4 18 3.552 18 3 18 2.448 17.553 2 17 2L7 2C6.447 2 6 2.448 6 3 6 3.552 6.447 4 7 4L7.707 4 7.707 9.294 6.293 10.708C6.105 10.896 6 11.151 6 11.415L6 13C6 13.552 6.447 14 7 14L11 14 11 21C11 21.552 11.447 22 12 22 12.553 22 13 21.552 13 21L13 14 17 14C17.553 14 18 13.552 18 13L18 11.415C18 11.151 17.895 10.896 17.707 10.708Z" />
                      </svg>
                    )}
                    <span style={{
                      fontSize: '12.5px', color: '#131210',
                      fontWeight: hasUnread ? 600 : 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {displayName}
                    </span>
                  </div>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '9.5px', color: '#9B9890',
                    flexShrink: 0, marginLeft: 8,
                  }}>
                    {formatTime(activityTime)}
                  </span>
                </div>
                {callSnippet ? (
                  <p style={{
                    fontSize: '11.5px', color: callSnippet.color,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span style={{ fontSize: 13 }}>{callSnippet.arrow}</span>
                    {callSnippet.label}
                  </p>
                ) : (
                  <p style={{
                    fontSize: '11.5px', color: '#9B9890',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontWeight: hasUnread ? 500 : 400,
                    ...(hasUnread && { color: '#5C5A55' }),
                  }}>
                    {conversation.lastMessage?.direction === 'outbound' && 'You: '}
                    {truncateMessage(conversation.lastMessage?.body)}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Hover action bar ── */}
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
          onMouseEnter={cancelClearHover}
          onMouseLeave={() => { setHoveredConv(null); setHoverRect(null) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2,
            background: '#FFFFFF', border: '1px solid #E3E1DB',
            borderRadius: 8, boxShadow: '0 4px 16px rgba(19,18,16,0.10)',
            padding: '3px 4px',
          }}>
            {callHook && callHook.selectedCallerNumber && (
              <button
                title={callHook.isCallActive ? 'Call in progress' : 'Call'}
                disabled={callHook.isCallActive}
                onClick={(e) => handleCallClick(e, hoveredConv.phone_number)}
                style={{ padding: 6, color: '#5C5A55', background: 'none', border: 'none', borderRadius: 6, cursor: callHook.isCallActive ? 'not-allowed' : 'pointer', opacity: callHook.isCallActive ? 0.4 : 1, display: 'flex' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z"/>
                </svg>
              </button>
            )}
            <button title={hoveredConv.status === 'closed' ? 'Mark as open' : 'Mark as done'}
              onClick={(e) => { e.stopPropagation(); hoveredConv.status === 'closed' ? onMarkAsOpen?.(hoveredConv.id) : onMarkAsDone?.(hoveredConv.id) }}
              style={{ padding: 6, color: '#5C5A55', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button title={hoveredConv.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}
              onClick={(e) => { e.stopPropagation(); hoveredConv.unreadCount > 0 ? onMarkAsRead?.(hoveredConv.id) : onMarkAsUnread?.(hoveredConv.id) }}
              style={{ padding: 6, color: '#5C5A55', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
              </svg>
            </button>
            <button title="More actions"
              onClick={(e) => { e.stopPropagation(); handleMoreClick(e, hoveredConv); setHoveredConv(null); setHoverRect(null) }}
              style={{ padding: 6, color: '#5C5A55', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Context menu ── */}
      <div
        style={{
          position: 'fixed',
          left: contextMenu ? `${contextMenu.position.x}px` : '-9999px',
          top: contextMenu ? `${contextMenu.position.y}px` : '-9999px',
          opacity: contextMenu ? 1 : 0,
          pointerEvents: contextMenu ? 'auto' : 'none',
          transition: 'none',
          background: '#FFFFFF', border: '1px solid #E3E1DB', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(19,18,16,0.12)',
          padding: '4px 0', zIndex: 50, minWidth: 180,
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {contextMenu && (
          <>
            {contextMenu.conversation.status === 'closed' ? (
              <button onClick={handleMarkAsOpen} style={menuItemStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                Mark as open
              </button>
            ) : (
              <button onClick={handleMarkAsDone} style={menuItemStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                Mark as done
              </button>
            )}
            <button onClick={handleMarkAsUnread} style={menuItemStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              Mark as unread
            </button>
            <button onClick={handlePinConversation} style={menuItemStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
              {contextMenu.conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
            </button>
            {onAssignScenario && (
              <button onClick={handleAssignScenario} style={menuItemStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                Assign scenario
              </button>
            )}
            <div style={{ borderTop: '1px solid #E3E1DB', margin: '4px 0' }} />
            <button onClick={handleBlockContact} style={menuItemStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
              Block contact
            </button>
            <button onClick={handleDeleteConversation} style={{ ...menuItemStyle, color: '#D63B1F' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(214,59,31,0.07)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              Delete conversation
            </button>
          </>
        )}
      </div>
    </>
  )
}
