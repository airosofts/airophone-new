'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { apiGet } from '@/lib/api-client'

export default function MentionTextarea({ value, onChange, onSubmit, placeholder = 'Write a note...', rows = 2 }) {
  const [members, setMembers] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownIndex, setDropdownIndex] = useState(0)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState(-1)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })
  const textareaRef = useRef(null)
  const membersRef = useRef([])

  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const res = await apiGet('/api/team/members')
        const data = await res.json()
        if (data.success) {
          setMembers(data.members || [])
          membersRef.current = data.members || []
        }
      } catch (e) { console.error('Failed to fetch members:', e) }
    }
    fetchMembers()
  }, [])

  const filteredMembers = members.filter(m =>
    m.name?.toLowerCase().includes(mentionQuery.toLowerCase())
  ).slice(0, 6)

  // Position dropdown near the textarea
  const updateDropdownPosition = useCallback(() => {
    if (!textareaRef.current) return
    const rect = textareaRef.current.getBoundingClientRect()
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left
    })
  }, [])

  const getMentionedIds = useCallback((text) => {
    return membersRef.current.filter(m => text.includes(`@${m.name}`)).map(m => m.id)
  }, [])

  const handleChange = useCallback((e) => {
    const text = e.target.value
    const cursorPos = e.target.selectionStart
    const ids = getMentionedIds(text)
    onChange(text, ids)

    // Check if we're in a mention context
    const textBeforeCursor = text.slice(0, cursorPos)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
      // Show dropdown if @ is at start or preceded by whitespace, and no space in query yet
      const charBeforeAt = lastAtIndex > 0 ? text[lastAtIndex - 1] : ' '
      if ((charBeforeAt === ' ' || charBeforeAt === '\n' || lastAtIndex === 0) && !textAfterAt.includes(' ')) {
        setMentionQuery(textAfterAt)
        setMentionStart(lastAtIndex)
        setShowDropdown(true)
        setDropdownIndex(0)
        updateDropdownPosition()
        return
      }
    }

    setShowDropdown(false)
  }, [onChange, getMentionedIds, updateDropdownPosition])

  const insertMention = useCallback((member) => {
    if (mentionStart === -1) return
    const before = value.slice(0, mentionStart)
    const after = value.slice(mentionStart + mentionQuery.length + 1) // +1 for @
    const newValue = `${before}@${member.name} ${after}`
    const ids = getMentionedIds(newValue)
    onChange(newValue, ids)
    setShowDropdown(false)
    setMentionStart(-1)

    // Focus back on textarea
    setTimeout(() => {
      const textarea = textareaRef.current
      if (textarea) {
        const newPos = mentionStart + member.name.length + 2 // @name + space
        textarea.focus()
        textarea.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }, [value, onChange, mentionStart, mentionQuery, getMentionedIds])

  const handleKeyDown = useCallback((e) => {
    if (showDropdown && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setDropdownIndex(i => (i + 1) % filteredMembers.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setDropdownIndex(i => (i - 1 + filteredMembers.length) % filteredMembers.length)
        return
      }
      if (e.key === 'Enter' && !e.metaKey) {
        e.preventDefault()
        insertMention(filteredMembers[dropdownIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowDropdown(false)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        insertMention(filteredMembers[dropdownIndex])
        return
      }
    }

    if (e.key === 'Enter' && e.metaKey) {
      onSubmit?.()
    }
  }, [showDropdown, filteredMembers, dropdownIndex, insertMention, onSubmit])

  // Close dropdown on blur (with delay so click on dropdown still works)
  const handleBlur = useCallback(() => {
    setTimeout(() => setShowDropdown(false), 200)
  }, [])

  const dropdown = showDropdown && filteredMembers.length > 0 && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed w-60 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-[9999] max-h-52 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {filteredMembers.map((member, idx) => (
            <button
              key={member.id}
              onMouseDown={(e) => { e.preventDefault(); insertMention(member) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                idx === dropdownIndex ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-[#C54A3F] flex items-center justify-center flex-shrink-0">
                {member.profile_photo_url ? (
                  <img src={member.profile_photo_url} alt="" className="w-6 h-6 rounded-full" />
                ) : (
                  <span className="text-[10px] font-semibold text-white">
                    {member.name?.charAt(0)?.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium truncate text-[13px]">{member.name}</p>
                <p className="text-[11px] text-gray-400 truncate">{member.email}</p>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )
    : null

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={() => { if (mentionStart !== -1) updateDropdownPosition() }}
        placeholder={placeholder}
        className="w-full px-3 pt-2.5 pb-1 text-[13px] text-gray-700 placeholder-gray-400 resize-none focus:outline-none bg-transparent leading-relaxed"
        rows={rows}
      />
      {dropdown}
    </div>
  )
}

// Helper to render note content with highlighted mentions
export function renderNoteWithMentions(content) {
  if (!content) return null

  // Match @mentions — name is one or more words starting with uppercase after @
  const regex = /(@[A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*)/g
  const parts = content.split(regex)

  return parts.map((part, i) => {
    if (part.startsWith('@') && /^@[A-Z]/.test(part)) {
      return (
        <span key={i} className="text-[#C54A3F] font-medium bg-red-50 rounded px-0.5">
          {part}
        </span>
      )
    }
    return part
  })
}
