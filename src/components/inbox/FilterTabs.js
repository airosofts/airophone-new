'use client'

import { useState, useRef, useEffect } from 'react'

export default function FilterTabs({ currentFilter, onFilterChange, conversations = [] }) {
  const [showStatusDropdown, setShowStatusDropdown] = useState(false)
  const dropdownRef = useRef(null)

  const getFilterCounts = () => {
    const counts = {
      all: conversations.length,
      unread: conversations.filter(c => c.unreadCount > 0).length,
      open: conversations.filter(c => c.status !== 'closed').length,
      done: conversations.filter(c => c.status === 'closed').length,
      unresponded: conversations.filter(c =>
        c.lastMessage?.direction === 'inbound' && !c.lastMessage?.read_at
      ).length,
    }
    return counts
  }

  const counts = getFilterCounts()

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowStatusDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const getStatusLabel = () => {
    if (currentFilter === 'open') return 'Open'
    if (currentFilter === 'done') return 'Done'
    return 'Open'
  }

  const handleStatusSelect = (status) => {
    onFilterChange(status)
    setShowStatusDropdown(false)
  }

  return (
    <div className="flex items-center gap-0">
      {/* Status Dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowStatusDropdown(!showStatusDropdown)}
          className={`flex items-center gap-1 px-4 py-2 text-sm font-medium transition-colors ${
            currentFilter === 'open' || currentFilter === 'done'
              ? 'text-gray-900 border-b-2 border-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span>{getStatusLabel()}</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showStatusDropdown && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
            <button
              onClick={() => handleStatusSelect('open')}
              className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                currentFilter === 'open' ? 'text-gray-900 font-medium' : 'text-gray-700'
              }`}
            >
              Open
              {counts.open > 0 && (
                <span className="ml-2 text-xs text-gray-500">{counts.open}</span>
              )}
            </button>
            <button
              onClick={() => handleStatusSelect('done')}
              className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                currentFilter === 'done' ? 'text-gray-900 font-medium' : 'text-gray-700'
              }`}
            >
              Done
              {counts.done > 0 && (
                <span className="ml-2 text-xs text-gray-500">{counts.done}</span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Unread Tab */}
      <button
        onClick={() => onFilterChange('unread')}
        className={`px-4 py-2 text-sm font-medium transition-colors ${
          currentFilter === 'unread'
            ? 'text-gray-900 border-b-2 border-gray-900'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Unread
        {counts.unread > 0 && (
          <span className="ml-2 text-xs text-gray-500">{counts.unread}</span>
        )}
      </button>

      {/* Unresponded Tab */}
      <button
        onClick={() => onFilterChange('unresponded')}
        className={`px-4 py-2 text-sm font-medium transition-colors ${
          currentFilter === 'unresponded'
            ? 'text-gray-900 border-b-2 border-gray-900'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Unresponded
        {counts.unresponded > 0 && (
          <span className="ml-2 text-xs text-gray-500">{counts.unresponded}</span>
        )}
      </button>
    </div>
  )
}
