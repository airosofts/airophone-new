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
          <svg width="20" height="20" viewBox="0 0 20 20" fill="#9B9890">
            <path d="M5.99805 8.28223C6.30871 7.8939 6.78015 7.91224 7.08594 8.07715L7.20605 8.15625L7.26367 8.20703C7.31678 8.25917 7.36011 8.31812 7.39453 8.38086C7.63506 8.74097 7.53729 9.20196 7.27734 9.46191C7.25791 9.48133 7.23726 9.49944 7.21582 9.5166C6.89023 9.77707 6.38593 9.78403 6.05469 9.45312C5.76853 9.16697 5.72608 8.73269 5.92188 8.40137C5.94382 8.3598 5.96834 8.31936 5.99805 8.28223ZM9.33301 8.28223C9.64367 7.89396 10.1151 7.91225 10.4209 8.07715L10.541 8.15625L10.5986 8.20703C10.6517 8.25915 10.6951 8.31814 10.7295 8.38086C10.97 8.74093 10.8722 9.20197 10.6123 9.46191C10.5929 9.4813 10.5722 9.49945 10.5508 9.5166C10.2252 9.77705 9.72089 9.78397 9.38965 9.45312C9.10349 9.16697 9.06104 8.73269 9.25684 8.40137C9.27877 8.35981 9.30332 8.31935 9.33301 8.28223ZM12.665 8.28223C12.9757 7.89405 13.4472 7.91226 13.7529 8.07715L13.873 8.15625L13.9307 8.20703C13.9837 8.25913 14.0271 8.31818 14.0615 8.38086C14.3019 8.74088 14.2041 9.20197 13.9443 9.46191C13.925 9.48127 13.9042 9.49948 13.8828 9.5166C13.5573 9.77703 13.0529 9.78387 12.7217 9.45312C12.4355 9.16697 12.3931 8.73269 12.5889 8.40137C12.6108 8.35984 12.6354 8.31932 12.665 8.28223ZM15 1.875C16.6954 1.875 18.125 3.18821 18.125 4.875V12.792C18.1248 14.4786 16.6953 15.792 15 15.792H13.958V18.333C13.958 18.5704 13.824 18.788 13.6113 18.8936C13.3986 18.9991 13.1441 18.9747 12.9551 18.8311L8.95605 15.792H5C3.30469 15.792 1.87518 14.4786 1.875 12.792V4.875C1.875 3.18821 3.30458 1.875 5 1.875H15ZM5 3.125C3.93375 3.125 3.125 3.93821 3.125 4.875V12.792C3.12519 13.7286 3.93387 14.542 5 14.542H9.16699C9.30347 14.5421 9.43626 14.5864 9.54492 14.6689L12.708 17.0723V15.167C12.708 14.8219 12.988 14.5422 13.333 14.542H15C16.0661 14.542 16.8748 13.7286 16.875 12.792V4.875C16.875 3.93821 16.0663 3.125 15 3.125H5Z"/>
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
                <svg width="16" height="16" viewBox="0 0 20 20" fill="#9B9890">
                  <path d="M5.99805 8.28223C6.30871 7.8939 6.78015 7.91224 7.08594 8.07715L7.20605 8.15625L7.26367 8.20703C7.31678 8.25917 7.36011 8.31812 7.39453 8.38086C7.63506 8.74097 7.53729 9.20196 7.27734 9.46191C7.25791 9.48133 7.23726 9.49944 7.21582 9.5166C6.89023 9.77707 6.38593 9.78403 6.05469 9.45312C5.76853 9.16697 5.72608 8.73269 5.92188 8.40137C5.94382 8.3598 5.96834 8.31936 5.99805 8.28223ZM9.33301 8.28223C9.64367 7.89396 10.1151 7.91225 10.4209 8.07715L10.541 8.15625L10.5986 8.20703C10.6517 8.25915 10.6951 8.31814 10.7295 8.38086C10.97 8.74093 10.8722 9.20197 10.6123 9.46191C10.5929 9.4813 10.5722 9.49945 10.5508 9.5166C10.2252 9.77705 9.72089 9.78397 9.38965 9.45312C9.10349 9.16697 9.06104 8.73269 9.25684 8.40137C9.27877 8.35981 9.30332 8.31935 9.33301 8.28223ZM12.665 8.28223C12.9757 7.89405 13.4472 7.91226 13.7529 8.07715L13.873 8.15625L13.9307 8.20703C13.9837 8.25913 14.0271 8.31818 14.0615 8.38086C14.3019 8.74088 14.2041 9.20197 13.9443 9.46191C13.925 9.48127 13.9042 9.49948 13.8828 9.5166C13.5573 9.77703 13.0529 9.78387 12.7217 9.45312C12.4355 9.16697 12.3931 8.73269 12.5889 8.40137C12.6108 8.35984 12.6354 8.31932 12.665 8.28223ZM15 1.875C16.6954 1.875 18.125 3.18821 18.125 4.875V12.792C18.1248 14.4786 16.6953 15.792 15 15.792H13.958V18.333C13.958 18.5704 13.824 18.788 13.6113 18.8936C13.3986 18.9991 13.1441 18.9747 12.9551 18.8311L8.95605 15.792H5C3.30469 15.792 1.87518 14.4786 1.875 12.792V4.875C1.875 3.18821 3.30458 1.875 5 1.875H15ZM5 3.125C3.93375 3.125 3.125 3.93821 3.125 4.875V12.792C3.12519 13.7286 3.93387 14.542 5 14.542H9.16699C9.30347 14.5421 9.43626 14.5864 9.54492 14.6689L12.708 17.0723V15.167C12.708 14.8219 12.988 14.5422 13.333 14.542H15C16.0661 14.542 16.8748 13.7286 16.875 12.792V4.875C16.875 3.93821 16.0663 3.125 15 3.125H5Z"/>
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
                      {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
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
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3.34459 3.76868C4.23952 2.87405 5.69 2.87484 6.58482 3.76965L7.56236 4.74719C8.31673 5.5017 8.27235 6.68841 7.49205 7.46887L6.80552 8.15442C7.26201 9.18598 7.95142 10.2114 8.86998 11.13C9.78885 12.0489 10.8148 12.7378 11.8456 13.1935L12.6014 12.4376C13.3333 11.7045 14.5216 11.7054 15.2538 12.4376L16.2313 13.4152L16.3885 13.589C17.1224 14.4894 17.0703 15.8172 16.2313 16.6564L15.6883 17.1993C14.9161 17.9714 13.8128 18.2818 12.7391 18.0792C10.4215 17.6411 7.92727 16.3064 5.81041 14.1896C3.69372 12.0729 2.35899 9.57932 1.92076 7.26184V7.26086C1.71826 6.18712 2.02938 5.08388 2.80162 4.31165L3.34459 3.76868ZM5.70103 4.65344C5.31975 4.27216 4.71655 4.24765 4.30748 4.58118L4.22838 4.65344L3.68443 5.19641C3.22226 5.65909 3.01862 6.33697 3.14927 7.02942L3.23033 7.41418C3.68625 9.34992 4.85231 11.4639 6.6942 13.3058C8.65886 15.2704 10.9333 16.4654 12.9706 16.8507C13.6634 16.9814 14.3419 16.7773 14.8045 16.3146L15.3475 15.7726C15.7539 15.366 15.7537 14.7067 15.3465 14.299L14.37 13.3214C14.156 13.1074 13.8258 13.0812 13.5838 13.2413L13.4862 13.3214L12.7176 14.09C12.3773 14.4302 11.8455 14.5603 11.371 14.3517V14.3507C10.1848 13.8312 9.02036 13.048 7.98619 12.0138C6.95601 10.9836 6.17437 9.82427 5.65416 8.6427V8.64172C5.44185 8.15995 5.57376 7.61958 5.91978 7.27356L6.60826 6.58508C6.94585 6.24735 6.90054 5.85308 6.67857 5.63098L5.70103 4.65344ZM10.8104 5.21594C11.8292 5.2022 12.8575 5.58055 13.6385 6.36145C14.4199 7.14277 14.7979 8.17167 14.784 9.19055C14.7793 9.53563 14.4953 9.81145 14.1503 9.80676C13.8052 9.80195 13.5294 9.51804 13.534 9.17297C13.5434 8.47368 13.285 7.77547 12.7547 7.24524C12.2243 6.715 11.5261 6.45645 10.827 6.46594C10.4819 6.47062 10.1979 6.19487 10.1932 5.84973C10.1885 5.50459 10.4653 5.22063 10.8104 5.21594ZM16.8895 9.18176C16.8895 7.62748 16.2968 6.07436 15.1112 4.88879C13.9256 3.7034 12.3723 3.11047 10.8182 3.11047C10.4732 3.1103 10.1932 2.83054 10.1932 2.48547C10.1932 2.1404 10.4732 1.86065 10.8182 1.86047C12.6906 1.86047 14.5666 2.57564 15.996 4.005C17.4252 5.43435 18.1395 7.30953 18.1395 9.18176C18.1395 9.52694 17.8597 9.80676 17.5145 9.80676C17.1695 9.80654 16.8895 9.52681 16.8895 9.18176Z"/>
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
