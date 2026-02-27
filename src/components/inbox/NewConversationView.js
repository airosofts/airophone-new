'use client'

import { useState, useRef, useEffect } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'

export default function NewConversationView({
  phoneNumber,
  formatPhoneNumber,
  onConversationCreated,
  onCancel,
  user
}) {
  const [recipientDisplay, setRecipientDisplay] = useState('')
  const [selectedContact, setSelectedContact] = useState(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)

  const toInputRef = useRef(null)
  const textareaRef = useRef(null)
  const searchTimeoutRef = useRef(null)

  useEffect(() => {
    toInputRef.current?.focus()
  }, [])

  const searchContacts = async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }

    setSearching(true)
    try {
      const response = await apiGet(`/api/contacts?q=${encodeURIComponent(query)}`)
      const data = await response.json()
      if (data.success && data.contacts?.length > 0) {
        setSearchResults(data.contacts)
        setShowDropdown(true)
      } else {
        setSearchResults([])
        setShowDropdown(false)
      }
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const handleRecipientChange = (value) => {
    setRecipientDisplay(value)
    setSelectedContact(null)
    setError('')

    clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      searchContacts(value)
    }, 300)
  }

  const handleSelectContact = (contact) => {
    setSelectedContact(contact)
    setRecipientDisplay(contact.business_name || formatPhoneNumber(contact.phone_number))
    setShowDropdown(false)
    setSearchResults([])
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const getFormattedRecipient = () => {
    if (selectedContact) return selectedContact.phone_number

    const raw = recipientDisplay.trim()
    const digits = raw.replace(/\D/g, '')
    if (raw.startsWith('+')) return raw
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
    return `+1${digits}`
  }

  const handleSend = async (e) => {
    e?.preventDefault()
    if (!recipientDisplay.trim() || !message.trim() || !phoneNumber || sending) return

    setSending(true)
    setError('')

    try {
      const toNumber = getFormattedRecipient()

      const response = await apiPost('/api/sms/send', {
        from: phoneNumber.phoneNumber,
        to: toNumber,
        message: message.trim()
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || data.message || 'Failed to send')

      if (data.conversation) {
        onConversationCreated(data.conversation)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const getInitials = (contact) => {
    const name = contact.business_name || contact.phone_number || ''
    const words = name.trim().split(' ')
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  return (
    <div className="flex flex-col h-full bg-white">

      {/* To: header bar */}
      <div className="border-b border-gray-200 bg-white px-4 py-2.5 flex items-center gap-3">
        <span className="text-sm font-semibold text-gray-800 flex-shrink-0">To:</span>

        <div className="flex-1 relative flex items-center gap-2 flex-wrap">
          {selectedContact ? (
            <span className="inline-flex items-center gap-1.5 bg-[#F5E6E4] text-[#C54A3F] text-sm font-medium px-2.5 py-0.5 rounded-md">
              {selectedContact.business_name || formatPhoneNumber(selectedContact.phone_number)}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setSelectedContact(null); setRecipientDisplay(''); setTimeout(() => toInputRef.current?.focus(), 0) }}
                className="text-[#C54A3F] hover:text-[#B73E34] transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ) : (
            <>
              {searching ? (
                <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-[#C54A3F] rounded-full animate-spin flex-shrink-0"></div>
              ) : null}
              <input
                ref={toInputRef}
                type="text"
                value={recipientDisplay}
                onChange={(e) => handleRecipientChange(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                placeholder="Name or phone number"
                className="flex-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent min-w-0"
              />
            </>
          )}

          {/* Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Contacts</p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {searchResults.map((contact) => (
                  <button
                    key={contact.id}
                    onMouseDown={() => handleSelectContact(contact)}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-3 transition-colors"
                  >
                    <div className="w-8 h-8 bg-[#C54A3F] rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                      {getInitials(contact)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {contact.business_name || formatPhoneNumber(contact.phone_number)}
                      </p>
                      {contact.business_name && (
                        <p className="text-xs text-gray-500">
                          {formatPhoneNumber(contact.phone_number)}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onCancel}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0"
          title="Cancel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Empty area */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-sm text-gray-400">
            {recipientDisplay ? 'Type a message to start the conversation' : 'Search for a contact or enter a phone number'}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Message input */}
      <div className="border-t border-gray-200 bg-white p-4">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={recipientDisplay ? 'Type a message...' : 'Enter a recipient first'}
            disabled={!recipientDisplay.trim() || sending}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:border-gray-400 text-sm disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
            style={{ minHeight: '36px', maxHeight: '120px' }}
            onInput={(e) => {
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(Math.max(e.target.scrollHeight, 36), 120)}px`
            }}
          />
          <button
            type="submit"
            disabled={!message.trim() || !recipientDisplay.trim() || sending}
            className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Send"
          >
            {sending ? (
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
