'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { apiGet, fetchWithWorkspace } from '@/lib/api-client'

export default function NotificationPanel({ onNavigateToConversation }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef(null)

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
    onNavigateToConversation?.(notification.conversation?.id, notification.note_id)
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
    <div ref={panelRef} className="relative">
      {/* Bell icon button */}
      <button
        onClick={handleToggle}
        className="relative p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-md transition-colors"
        title="Notifications"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#C54A3F] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute left-full ml-2 top-0 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-[480px] flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-[11px] text-[#C54A3F] hover:text-[#B73E34] font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <p className="text-sm text-gray-400">No notifications yet</p>
                <p className="text-xs text-gray-300 mt-1">Mentions will appear here</p>
              </div>
            ) : (
              <div>
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                      !notification.is_read ? 'bg-red-50/40' : ''
                    }`}
                  >
                    <div className="flex gap-2.5">
                      {/* Unread dot */}
                      <div className="pt-1.5 flex-shrink-0">
                        <div className={`w-2 h-2 rounded-full ${
                          !notification.is_read ? 'bg-[#C54A3F]' : 'bg-transparent'
                        }`} />
                      </div>

                      {/* Actor avatar */}
                      <div className="flex-shrink-0">
                        {notification.actor?.profile_photo_url ? (
                          <img src={notification.actor.profile_photo_url} alt="" className="w-7 h-7 rounded-full" />
                        ) : (
                          <div className="w-7 h-7 bg-[#C54A3F] rounded-full flex items-center justify-center">
                            <span className="text-[10px] font-semibold text-white">
                              {notification.actor?.name?.charAt(0)?.toUpperCase() || '?'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-gray-800 leading-snug">
                          <span className="font-semibold">{notification.actor?.name || 'Someone'}</span>
                          {' mentioned you in a note'}
                        </p>
                        {notification.content && (
                          <p className="text-[12px] text-gray-400 mt-0.5 truncate">
                            &ldquo;{notification.content}&rdquo;
                          </p>
                        )}
                        <p className="text-[11px] text-gray-300 mt-1">
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
        </div>
      )}
    </div>
  )
}
