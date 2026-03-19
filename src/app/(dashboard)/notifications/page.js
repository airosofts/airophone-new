'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, fetchWithWorkspace } from '@/lib/api-client'

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
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
    const fromNumber = notification.conversation?.from_number
    const conversationId = notification.conversation?.id
    const noteId = notification.note_id

    const inboxUrl = fromNumber
      ? `/inbox?from=${encodeURIComponent(fromNumber)}`
      : '/inbox'
    router.push(inboxUrl)

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
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.is_read
    if (filter === 'read') return n.is_read
    return true
  })

  const unreadCount = notifications.filter(n => !n.is_read).length

  const tabs = [
    { id: 'all', label: 'All', icon: 'fa-bell' },
    { id: 'unread', label: 'Unread', icon: 'fa-circle' },
    { id: 'read', label: 'Read', icon: 'fa-check-circle' },
  ]

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-auto">
      <div className="p-6 space-y-4">

        {/* Tab Navigation — matches Contacts page */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 self-start w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === tab.id
                  ? 'bg-[#C54A3F] text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <i className={`fas ${tab.icon} text-xs`}></i>
              {tab.label}
              {tab.id === 'unread' && unreadCount > 0 && (
                <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full ${
                  filter === 'unread' ? 'bg-white/20 text-white' : 'bg-[#C54A3F] text-white'
                }`}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Main Card — matches Contacts/Campaigns card */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {/* Card Header */}
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 flex-shrink-0">Notifications</h3>
              <span className="text-xs text-gray-400">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </span>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#C54A3F] hover:bg-[#B73E34] text-white text-sm font-medium rounded-md transition-colors flex-shrink-0"
              >
                <i className="fas fa-check-double text-xs"></i>
                Mark all read
              </button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-8"></th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">From</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Note</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Conversation</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Time</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="px-5 py-10 text-center">
                      <div className="relative w-8 h-8 mx-auto mb-3">
                        <div className="absolute inset-0 border-2 border-gray-200 rounded-full"></div>
                        <div className="absolute inset-0 border-2 border-[#C54A3F] border-t-transparent rounded-full animate-spin"></div>
                      </div>
                      <p className="text-sm text-gray-400">Loading notifications...</p>
                    </td>
                  </tr>
                ) : filteredNotifications.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-5 py-10 text-center">
                      <p className="text-sm text-gray-500">
                        {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {filter === 'unread' ? 'You\'re all caught up!' : 'When someone @mentions you in a note, it will appear here'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredNotifications.map((notification) => (
                    <tr
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={`hover:bg-gray-50 transition-colors cursor-pointer ${
                        !notification.is_read ? 'bg-red-50/30' : ''
                      }`}
                    >
                      {/* Unread dot */}
                      <td className="px-5 py-3">
                        {!notification.is_read && (
                          <div className="w-2 h-2 rounded-full bg-[#C54A3F]" />
                        )}
                      </td>

                      {/* From */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          {notification.actor?.profile_photo_url ? (
                            <img src={notification.actor.profile_photo_url} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 bg-[#C54A3F] rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-[10px] font-semibold text-white">
                                {notification.actor?.name?.charAt(0)?.toUpperCase() || '?'}
                              </span>
                            </div>
                          )}
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {notification.actor?.name || 'Someone'}
                          </span>
                        </div>
                      </td>

                      {/* Note content */}
                      <td className="px-5 py-3 max-w-xs">
                        <p className="text-sm text-gray-600 truncate">
                          {notification.content || 'Mentioned you in a note'}
                        </p>
                      </td>

                      {/* Conversation */}
                      <td className="px-5 py-3">
                        <span className="text-sm text-gray-500">
                          {notification.conversation?.name || notification.conversation?.phone_number || '—'}
                        </span>
                      </td>

                      {/* Time */}
                      <td className="px-5 py-3">
                        <span className="text-sm text-gray-400 whitespace-nowrap">
                          {formatTime(notification.created_at)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          notification.is_read
                            ? 'bg-gray-100 text-gray-600'
                            : 'bg-red-50 text-[#C54A3F]'
                        }`}>
                          {notification.is_read ? 'Read' : 'Unread'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          {!loading && filteredNotifications.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500">
                Showing {filteredNotifications.length} notification{filteredNotifications.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
