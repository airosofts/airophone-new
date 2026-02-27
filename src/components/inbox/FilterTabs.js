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
    if (currentFilter === 'done') return 'Done'
    return 'Open'
  }

  const handleStatusSelect = (status) => {
    onFilterChange(status)
    setShowStatusDropdown(false)
  }

  const isStatusActive = currentFilter === 'open' || currentFilter === 'done'

  return (
    <div className="flex items-center gap-0.5">
      {/* Open / Done dropdown — always shown as a pill (it's the primary filter) */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowStatusDropdown(!showStatusDropdown)}
          className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium transition-colors ${
            isStatusActive
              ? 'bg-gray-100 text-gray-800'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <span>{getStatusLabel()}</span>
          <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showStatusDropdown && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[120px]">
            <button
              onClick={() => handleStatusSelect('open')}
              className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                currentFilter === 'open' ? 'text-gray-900 font-medium' : 'text-gray-700'
              }`}
            >
              Open
            </button>
            <button
              onClick={() => handleStatusSelect('done')}
              className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                currentFilter === 'done' ? 'text-gray-900 font-medium' : 'text-gray-700'
              }`}
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Unread — pill when active, plain text when inactive */}
      <button
        onClick={() => onFilterChange('unread')}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
          currentFilter === 'unread'
            ? 'bg-gray-100 text-gray-800'
            : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        Unread
        {counts.unread > 0 && (
          <span className={`ml-1 text-xs ${currentFilter === 'unread' ? 'text-gray-500' : 'text-gray-400'}`}>
            {counts.unread}
          </span>
        )}
      </button>

      {/* Unresponded — pill when active, plain text when inactive */}
      <button
        onClick={() => onFilterChange('unresponded')}
        className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
          currentFilter === 'unresponded'
            ? 'bg-gray-100 text-gray-800'
            : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        Unresponded
        {counts.unresponded > 0 && (
          <span className={`ml-1 text-xs ${currentFilter === 'unresponded' ? 'text-gray-500' : 'text-gray-400'}`}>
            {counts.unresponded}
          </span>
        )}
      </button>
    </div>
  )
}
