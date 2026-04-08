'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, fetchWithWorkspace } from '@/lib/api-client'

export default function NotificationPanel({ onNavigateToConversation }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef(null)
  const router = useRouter()

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiGet('/api/notifications')
      const data = await res.json()
      if (data.success) {
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount and poll every 30s
  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Close panel on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleToggle = () => {
    setIsOpen(prev => !prev)
    if (!isOpen) fetchNotifications()
  }

  const markAsRead = async (notificationIds) => {
    try {
      await fetchWithWorkspace('/api/notifications', {
        method: 'PUT',
        body: JSON.stringify({ notificationIds })
      })
      setNotifications(prev =>
        prev.map(n => notificationIds.includes(n.id) ? { ...n, is_read: true } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - notificationIds.length))
    } catch (e) {
      console.error('Failed to mark notifications as read:', e)
    }
  }

  const markAllAsRead = async () => {
    try {
      await fetchWithWorkspace('/api/notifications', {
        method: 'PUT',
        body: JSON.stringify({ markAll: true })
      })
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch (e) {
      console.error('Failed to mark all as read:', e)
    }
  }

  const handleNotificationClick = (notification) => {
    if (!notification.is_read) {
      markAsRead([notification.id])
    }
    setIsOpen(false)
    onNavigateToConversation?.(
      notification.conversation?.id,
      notification.note_id,
      notification.conversation?.from_number
    )
  }

  const formatTime = (dateStr) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Bell icon button */}
      <button
        onClick={handleToggle}
        style={{
          position: 'relative', padding: 4, display: 'flex',
          color: '#9B9890', cursor: 'pointer',
          background: 'none', border: 'none', borderRadius: 4,
          transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#5C5A55' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#9B9890' }}
        title="Notifications"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2,
            width: 16, height: 16, borderRadius: '50%',
            background: '#D63B1F', color: '#fff',
            fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div style={{
          position: 'absolute', left: '100%', marginLeft: 8, top: 0,
          width: 320, background: '#FFFFFF',
          border: '1px solid #E3E1DB', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(19,18,16,0.10)',
          zIndex: 50, maxHeight: 480,
          display: 'flex', flexDirection: 'column',
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 16px', borderBottom: '1px solid #E3E1DB',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#131210', letterSpacing: '-0.02em' }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                style={{
                  fontSize: 11, color: '#D63B1F', fontWeight: 500,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && notifications.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#9B9890' }}>Loading...</div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D4D1C9" strokeWidth="1.5" style={{ margin: '0 auto 8px' }}>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <p style={{ fontSize: 13, color: '#9B9890' }}>No notifications yet</p>
                <p style={{ fontSize: 11, color: '#D4D1C9', marginTop: 4 }}>Mentions will appear here</p>
              </div>
            ) : (
              <div>
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '12px 16px',
                      borderBottom: '1px solid #EFEDE8',
                      background: !notification.is_read ? 'rgba(214,59,31,0.04)' : 'transparent',
                      cursor: 'pointer', border: 'none',
                      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = !notification.is_read ? 'rgba(214,59,31,0.04)' : 'transparent' }}
                  >
                    <div style={{ display: 'flex', gap: 10 }}>
                      {/* Unread dot */}
                      <div style={{ paddingTop: 6, flexShrink: 0 }}>
                        <div style={{
                          width: 7, height: 7, borderRadius: '50%',
                          background: !notification.is_read ? '#D63B1F' : 'transparent',
                        }} />
                      </div>

                      {/* Actor avatar */}
                      <div style={{ flexShrink: 0 }}>
                        {notification.actor?.profile_photo_url ? (
                          <img src={notification.actor.profile_photo_url} alt="" style={{ width: 26, height: 26, borderRadius: '50%' }} />
                        ) : (
                          <div style={{
                            width: 26, height: 26, borderRadius: '50%',
                            background: 'rgba(214,59,31,0.14)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, fontWeight: 600, color: '#D63B1F',
                          }}>
                            {notification.actor?.name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, color: '#131210', lineHeight: 1.4 }}>
                          <span style={{ fontWeight: 600 }}>{notification.actor?.name || 'Someone'}</span>
                          {' mentioned you in a note'}
                        </p>
                        {notification.content && (
                          <p style={{ fontSize: 11.5, color: '#9B9890', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            &ldquo;{notification.content}&rdquo;
                          </p>
                        )}
                        <p style={{
                          fontSize: 10, color: '#D4D1C9', marginTop: 4,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {formatTime(notification.created_at)}
                          {notification.conversation?.phone_number && (
                            <span> &middot; {notification.conversation.phone_number}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* See all link */}
          <div style={{
            padding: '10px 16px', borderTop: '1px solid #E3E1DB', flexShrink: 0,
          }}>
            <button
              onClick={() => { setIsOpen(false); router.push('/notifications') }}
              style={{
                width: '100%', textAlign: 'center',
                fontSize: 12, fontWeight: 500, color: '#D63B1F',
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
            >
              See all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
