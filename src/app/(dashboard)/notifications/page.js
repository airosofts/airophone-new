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
    <div className="h-full bg-[#F7F6F3] flex flex-col overflow-auto">
      <div className="p-6 space-y-4">

        {/* Tab Navigation — matches Contacts page */}
        <div className="flex items-center gap-1 bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg p-1 self-start w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === tab.id
                  ? 'bg-[#D63B1F] text-white'
                  : 'text-[#5C5A55] hover:bg-[#F7F6F3]'
              }`}
            >
              <i className={`fas ${tab.icon} text-xs`}></i>
              {tab.label}
              {tab.id === 'unread' && unreadCount > 0 && (
                <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full ${
                  filter === 'unread' ? 'bg-[#FFFFFF]/20 text-white' : 'bg-[#D63B1F] text-white'
                }`}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Main Card — matches Contacts/Campaigns card */}
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg overflow-hidden">
          {/* Card Header */}
          <div className="px-5 py-3.5 border-b border-[#E3E1DB] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-[#131210] flex-shrink-0">Notifications</h3>
              <span className="text-xs text-[#9B9890]">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </span>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-medium rounded-md transition-colors flex-shrink-0"
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
                <tr className="bg-[#F7F6F3] border-b border-[#E3E1DB]">
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider w-8"></th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">From</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Note</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Conversation</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Time</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E1DB]">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="px-5 py-10 text-center">
                      <div className="relative w-8 h-8 mx-auto mb-3">
                        <div className="absolute inset-0 border-2 border-[#E3E1DB] rounded-full"></div>
                        <div className="absolute inset-0 border-2 border-[#D63B1F] border-t-transparent rounded-full animate-spin"></div>
                      </div>
                      <p className="text-sm text-[#9B9890]">Loading notifications...</p>
                    </td>
                  </tr>
                ) : filteredNotifications.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-5 py-10 text-center">
                      <p className="text-sm text-[#9B9890]">
                        {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                      </p>
                      <p className="text-xs text-[#9B9890] mt-1">
                        {filter === 'unread' ? 'You\'re all caught up!' : 'When someone @mentions you in a note, it will appear here'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredNotifications.map((notification) => (
                    <tr
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={`hover:bg-[#F7F6F3] transition-colors cursor-pointer ${
                        !notification.is_read ? 'bg-red-50/30' : ''
                      }`}
                    >
                      {/* Unread dot */}
                      <td className="px-5 py-3">
                        {!notification.is_read && (
                          <div className="w-2 h-2 rounded-full bg-[#D63B1F]" />
                        )}
                      </td>

                      {/* From */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          {notification.actor?.profile_photo_url ? (
                            <img src={notification.actor.profile_photo_url} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 bg-[#D63B1F] rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-[10px] font-semibold text-white">
                                {notification.actor?.name?.charAt(0)?.toUpperCase() || '?'}
                              </span>
                            </div>
                          )}
                          <span className="text-sm font-medium text-[#131210] truncate">
                            {notification.actor?.name || 'Someone'}
                          </span>
                        </div>
                      </td>

                      {/* Note content */}
                      <td className="px-5 py-3 max-w-xs">
                        <p className="text-sm text-[#5C5A55] truncate">
                          {notification.content || 'Mentioned you in a note'}
                        </p>
                      </td>

                      {/* Conversation */}
                      <td className="px-5 py-3">
                        <span className="text-sm text-[#9B9890]">
                          {notification.conversation?.name || notification.conversation?.phone_number || '—'}
                        </span>
                      </td>

                      {/* Time */}
                      <td className="px-5 py-3">
                        <span className="text-sm text-[#9B9890] whitespace-nowrap">
                          {formatTime(notification.created_at)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          notification.is_read
                            ? 'bg-[#EFEDE8] text-[#5C5A55]'
                            : 'bg-red-50 text-[#D63B1F]'
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
            <div className="px-5 py-3 border-t border-[#E3E1DB] bg-[#F7F6F3]">
              <p className="text-xs text-[#9B9890]">
                Showing {filteredNotifications.length} notification{filteredNotifications.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
