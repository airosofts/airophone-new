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
    // Clicking the already-active option clears the filter back to 'all'
    onFilterChange(currentFilter === status ? 'all' : status)
    setShowStatusDropdown(false)
  }

  const isStatusActive = currentFilter === 'open' || currentFilter === 'done'

  const tabBase = {
    fontSize: 12, padding: '4px 10px', borderRadius: 6,
    cursor: 'pointer', border: 'none',
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    transition: 'all 0.15s', fontWeight: 400,
  }
  const tabActive = { background: 'rgba(214,59,31,0.07)', color: '#D63B1F', fontWeight: 500 }
  const tabInactive = { background: 'transparent', color: '#9B9890' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {/* Open / Done dropdown */}
      <div style={{ position: 'relative' }} ref={dropdownRef}>
        <button
          onClick={() => setShowStatusDropdown(!showStatusDropdown)}
          style={{
            ...tabBase,
            ...(isStatusActive ? tabActive : tabInactive),
            display: 'flex', alignItems: 'center', gap: 4,
          }}
          onMouseEnter={(e) => { if (!isStatusActive) { e.currentTarget.style.background = '#EFEDE8'; e.currentTarget.style.color = '#5C5A55' } }}
          onMouseLeave={(e) => { if (!isStatusActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9B9890' } }}
        >
          <span>{getStatusLabel()}</span>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.5 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showStatusDropdown && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            background: '#FFFFFF', border: '1px solid #E3E1DB', borderRadius: 8,
            boxShadow: '0 8px 32px rgba(19,18,16,0.10)', padding: '4px 0',
            zIndex: 50, minWidth: 120,
          }}>
            {['open', 'done'].map(s => (
              <button
                key={s}
                onClick={() => handleStatusSelect(s)}
                style={{
                  width: '100%', padding: '8px 14px', textAlign: 'left',
                  fontSize: 12.5, border: 'none', cursor: 'pointer',
                  background: 'transparent',
                  color: currentFilter === s ? '#131210' : '#5C5A55',
                  fontWeight: currentFilter === s ? 500 : 400,
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F6F3' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Unread */}
      <button
        onClick={() => onFilterChange(currentFilter === 'unread' ? 'all' : 'unread')}
        style={{
          ...tabBase,
          ...(currentFilter === 'unread' ? tabActive : tabInactive),
        }}
        onMouseEnter={(e) => { if (currentFilter !== 'unread') { e.currentTarget.style.background = '#EFEDE8'; e.currentTarget.style.color = '#5C5A55' } }}
        onMouseLeave={(e) => { if (currentFilter !== 'unread') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9B9890' } }}
      >
        Unread
        {counts.unread > 0 && (
          <span style={{ marginLeft: 4, fontSize: 11, color: currentFilter === 'unread' ? '#D63B1F' : '#9B9890' }}>
            {counts.unread}
          </span>
        )}
      </button>

      {/* Unresponded */}
      <button
        onClick={() => onFilterChange(currentFilter === 'unresponded' ? 'all' : 'unresponded')}
        style={{
          ...tabBase,
          ...(currentFilter === 'unresponded' ? tabActive : tabInactive),
        }}
        onMouseEnter={(e) => { if (currentFilter !== 'unresponded') { e.currentTarget.style.background = '#EFEDE8'; e.currentTarget.style.color = '#5C5A55' } }}
        onMouseLeave={(e) => { if (currentFilter !== 'unresponded') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9B9890' } }}
      >
        Unresponded
        {counts.unresponded > 0 && (
          <span style={{ marginLeft: 4, fontSize: 11, color: currentFilter === 'unresponded' ? '#D63B1F' : '#9B9890' }}>
            {counts.unresponded}
          </span>
        )}
      </button>
    </div>
  )
}
