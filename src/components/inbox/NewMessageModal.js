//components/inbox/ConversationList.js


'use client'

import { useState } from 'react'
import { apiPost } from '@/lib/api-client'

export default function NewMessageModal({ phoneNumber, formatPhoneNumber, onClose, onConversationCreated }) {
  const [recipient, setRecipient] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!recipient.trim() || !message.trim()) {
      setError('Please enter both recipient and message')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Format phone number
      const cleanNumber = recipient.replace(/\D/g, '')
      let formattedNumber
      
      if (cleanNumber.length === 10) {
        formattedNumber = `+1${cleanNumber}`
      } else if (cleanNumber.length === 11 && cleanNumber.startsWith('1')) {
        formattedNumber = `+${cleanNumber}`
      } else if (recipient.startsWith('+')) {
        formattedNumber = recipient
      } else {
        formattedNumber = `+1${cleanNumber}`
      }

      // Send message using workspace API client
      const response = await apiPost('/api/sms/send', {
        from: phoneNumber.phoneNumber,
        to: formattedNumber,
        message: message.trim()
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to send message')
      }

      // Get the conversation
      if (data.conversation) {
        onConversationCreated(data.conversation)
      }

      onClose()

    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 modal-backdrop flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-auto slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">New Conversation</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* From Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              From
            </label>
            <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-sm text-gray-900">
                {formatPhoneNumber(phoneNumber?.phoneNumber)}
              </span>
            </div>
          </div>

          {/* To Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              To Number
            </label>
            <input
              type="tel"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-primary"
              required
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-primary resize-none"
              rows={4}
              required
            />
            <div className="text-right text-xs text-gray-500 mt-1">
              {message.length}/1600 characters
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !recipient.trim() || !message.trim()}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary-hover rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading ? (
                <div className="spinner w-4 h-4 mr-2"></div>
              ) : null}
              {loading ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}