'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, fetchWithWorkspace } from '@/lib/api-client'

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all' | 'unread' | 'read'
  const router = useRouter()

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiGet('/api/notifications')
      const data = await res.json()
      if (data.success) {
        setNotifications(data.notifications || [])
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const markAsRead = async (notificationIds) => {
    try {
      await fetchWithWorkspace('/api/notifications', {
        method: 'PUT',
        body: JSON.stringify({ notificationIds })
      })
      setNotifications(prev =>
        prev.map(n => notificationIds.includes(n.id) ? { ...n, is_read: true } : n)
      )
    } catch (e) {
      console.error('Failed to mark as read:', e)
    }
  }

  const markAllAsRead = async () => {
    try {
      await fetchWithWorkspace('/api/notifications', {
        method: 'PUT',
        body: JSON.stringify({ markAll: true })
      })
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    } catch (e) {
      console.error('Failed to mark all as read:', e)
    }
  }

  const handleNotificationClick = (notification) => {
    if (!notification.is_read) {
      markAsRead([notification.id])
    }
    // Navigate to inbox with correct phone line
    const fromNumber = notification.conversation?.from_number
    const conversationId = notification.conversation?.id
    const noteId = notification.note_id

    const inboxUrl = fromNumber
      ? `/inbox?from=${encodeURIComponent(fromNumber)}`
      : '/inbox'
    router.push(inboxUrl)

    // Dispatch event after navigation for inbox to pick up
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('notification-navigate', {
        detail: { conversationId, noteId }
      }))
    }, 600)
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
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.is_read
    if (filter === 'read') return n.is_read
    return true
  })

  const unreadCount = notifications.filter(n => !n.is_read).length

  // Group notifications by date
  const grouped = {}
  filteredNotifications.forEach(n => {
    const dateKey = new Date(n.created_at).toDateString()
    if (!grouped[dateKey]) grouped[dateKey] = []
    grouped[dateKey].push(n)
  })
  const groupedEntries = Object.entries(grouped)

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Notifications</h1>
              <p className="text-sm text-gray-400 mt-0.5">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-[#C54A3F] hover:text-[#B73E34] font-medium px-3 py-1.5 rounded-md hover:bg-red-50 transition-colors"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1">
            {[
              { key: 'all', label: 'All' },
              { key: 'unread', label: 'Unread' },
              { key: 'read', label: 'Read' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  filter === tab.key
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tab.label}
                {tab.key === 'unread' && unreadCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-[#C54A3F] text-white rounded-full">
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Notification list */}
      <div className="max-w-3xl mx-auto px-6 py-4">
        {loading ? (
          <div className="py-16 text-center">
            <div className="relative w-10 h-10 mx-auto mb-4">
              <div className="absolute inset-0 border-3 border-gray-200 rounded-full"></div>
              <div className="absolute inset-0 border-3 border-[#C54A3F] border-t-transparent rounded-full animate-spin"></div>
            </div>
            <p className="text-sm text-gray-400">Loading notifications...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="py-20 text-center">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-600 mb-1">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </p>
            <p className="text-xs text-gray-400">
              {filter === 'unread' ? 'You\'re all caught up!' : 'When someone @mentions you in a note, it will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedEntries.map(([dateKey, items]) => (
              <div key={dateKey}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2 px-1">
                  {formatDate(items[0].created_at)}
                </p>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
                  {items.map((notification) => (
                    <button
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={`w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors ${
                        !notification.is_read ? 'bg-red-50/30' : ''
                      }`}
                    >
                      <div className="flex gap-3">
                        {/* Unread dot */}
                        <div className="pt-2 flex-shrink-0 w-3">
                          {!notification.is_read && (
                            <div className="w-2.5 h-2.5 rounded-full bg-[#C54A3F]" />
                          )}
                        </div>

                        {/* Actor avatar */}
                        <div className="flex-shrink-0">
                          {notification.actor?.profile_photo_url ? (
                            <img src={notification.actor.profile_photo_url} alt="" className="w-9 h-9 rounded-full" />
                          ) : (
                            <div className="w-9 h-9 bg-[#C54A3F] rounded-full flex items-center justify-center">
                              <span className="text-xs font-semibold text-white">
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
                            <div className="mt-1.5 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                              <p className="text-[12px] text-gray-500 line-clamp-2 leading-relaxed">
                                {notification.content}
                              </p>
                            </div>
                          )}

                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-[11px] text-gray-400">{formatTime(notification.created_at)}</span>
                            {notification.conversation?.phone_number && (
                              <>
                                <span className="text-gray-300">&middot;</span>
                                <span className="text-[11px] text-gray-400">
                                  {notification.conversation.name || notification.conversation.phone_number}
                                </span>
                              </>
                            )}
                            <span className="ml-auto text-[11px] text-[#C54A3F] font-medium opacity-0 group-hover:opacity-100">
                              Open chat &rarr;
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
