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
    <div className="flex flex-col h-full bg-[#FFFFFF]">

      {/* To: header bar */}
      <div className="border-b border-[#E3E1DB] bg-[#FFFFFF] px-4 py-2.5 flex items-center gap-3">
        <span className="text-sm font-semibold text-[#131210] flex-shrink-0">To:</span>

        <div className="flex-1 relative flex items-center gap-2 flex-wrap">
          {selectedContact ? (
            <span className="inline-flex items-center gap-1.5 bg-[#F5E6E4] text-[#D63B1F] text-sm font-medium px-2.5 py-0.5 rounded-md">
              {selectedContact.business_name || formatPhoneNumber(selectedContact.phone_number)}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setSelectedContact(null); setRecipientDisplay(''); setTimeout(() => toInputRef.current?.focus(), 0) }}
                className="text-[#D63B1F] hover:text-[#c23119] transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ) : (
            <>
              {searching ? (
                <div className="w-3.5 h-3.5 border-2 border-[#D4D1C9] border-t-[#D63B1F] rounded-full animate-spin flex-shrink-0"></div>
              ) : null}
              <input
                ref={toInputRef}
                type="text"
                value={recipientDisplay}
                onChange={(e) => handleRecipientChange(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                placeholder="Name or phone number"
                className="flex-1 text-sm text-[#131210] placeholder-[#9B9890] focus:outline-none bg-transparent min-w-0"
              />
            </>
          )}

          {/* Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-2 border-b border-[#E3E1DB] bg-[#F7F6F3]">
                <p className="text-[10px] font-semibold text-[#9B9890] uppercase tracking-widest">Contacts</p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {searchResults.map((contact) => (
                  <button
                    key={contact.id}
                    onMouseDown={() => handleSelectContact(contact)}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#F7F6F3] flex items-center gap-3 transition-colors"
                  >
                    <div className="w-8 h-8 bg-[#D63B1F] rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                      {getInitials(contact)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#131210] truncate">
                        {contact.business_name || formatPhoneNumber(contact.phone_number)}
                      </p>
                      {contact.business_name && (
                        <p className="text-xs text-[#9B9890]">
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
          className="p-1 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded-full transition-colors flex-shrink-0"
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
          <div className="w-12 h-12 bg-[#EFEDE8] rounded-lg flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-[#D4D1C9]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-sm text-[#9B9890]">
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
      <div className="border-t border-[#E3E1DB] bg-[#FFFFFF] p-4">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={recipientDisplay ? 'Type a message...' : 'Enter a recipient first'}
            disabled={!recipientDisplay.trim() || sending}
            className="flex-1 px-3 py-2 border border-[#D4D1C9] rounded-lg resize-none focus:outline-none focus:border-[#D4D1C9] text-sm disabled:bg-[#F7F6F3] disabled:text-[#9B9890] disabled:cursor-not-allowed"
            style={{ minHeight: '36px', maxHeight: '120px' }}
            onInput={(e) => {
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(Math.max(e.target.scrollHeight, 36), 120)}px`
            }}
          />
          <button
            type="submit"
            disabled={!message.trim() || !recipientDisplay.trim() || sending}
            className="p-2 text-[#5C5A55] hover:text-[#131210] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Send"
          >
            {sending ? (
              <div className="w-5 h-5 border-2 border-[#D4D1C9] border-t-[#5C5A55] rounded-full animate-spin"></div>
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
