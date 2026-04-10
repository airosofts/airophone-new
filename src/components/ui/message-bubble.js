'use client'

import { useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { format, differenceInHours, isToday, isYesterday, parseISO } from 'date-fns'

export default function MessageBubble({ message, user }) {
  const [showDeliveryDetails, setShowDeliveryDetails] = useState(false)
  const isOutbound = message.direction === 'outbound'
  const isOptimistic = message.isOptimistic

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return ''

    const timezone = 'America/New_York'
    const date = parseISO(timestamp)
    const now = new Date()
    const diffInHours = differenceInHours(now, date)

    // If today, show time only in EST
    if (isToday(date)) {
      return formatInTimeZone(date, timezone, 'h:mm a')
    }

    // If yesterday
    if (isYesterday(date)) {
      return 'Yesterday ' + formatInTimeZone(date, timezone, 'h:mm a')
    }

    // If this week, show day and time
    if (diffInHours < 168) {
      return formatInTimeZone(date, timezone, 'EEE h:mm a')
    }

    // Otherwise show date and time
    return formatInTimeZone(date, timezone, 'MMM d h:mm a')
  }

  const renderMessageText = (text) => {
    if (!text) return null
    const urlRegex = /https?:\/\/[^\s]+/g
    const parts = []
    let lastIndex = 0
    let match
    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
      parts.push({ type: 'url', content: match[0] })
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) parts.push({ type: 'text', content: text.slice(lastIndex) })
    return parts.map((part, i) =>
      part.type === 'url' ? (
        <a
          key={i}
          href={part.content}
          target="_blank"
          rel="noopener noreferrer"
          className={isOutbound ? 'underline text-white/90 hover:text-white break-all' : 'underline text-[#D63B1F] hover:text-[#c23119] break-all'}
          onClick={(e) => e.stopPropagation()}
        >
          {part.content}
        </a>
      ) : (
        <span key={i}>{part.content}</span>
      )
    )
  }

  const getStatusIcon = (status, isOptimistic) => {
    if (isOptimistic || status === 'sending') {
      return (
        <div className="relative w-3 h-3 ml-1.5">
          <div className="absolute inset-0 border border-white/40 rounded-full"></div>
          <div className="absolute inset-0 border border-white border-t-transparent rounded-full animate-spin"></div>
        </div>
      )
    }

    switch (status) {
      case 'sent':
        return (
          <svg className="h-3.5 w-3.5 text-white/70 ml-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        )
      case 'delivered':
        return (
          <div className="flex ml-1.5">
            <svg className="h-3.5 w-3.5 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            <svg className="h-3.5 w-3.5 text-white/90 -ml-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )
      case 'failed':
        return (
          <svg className="h-3.5 w-3.5 text-red-300 ml-1.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )
      default:
        return null
    }
  }

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} group`}>
      <div className={`max-w-[85%] sm:max-w-md md:max-w-lg ${isOutbound ? 'order-1' : 'order-2'}`}>
        {/* Message Bubble */}
        <div className="relative">
          <div
            className={`px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-2xl relative ${
              isOutbound
                ? `bg-[#D63B1F] text-white ${isOptimistic ? 'opacity-60' : ''}`
                : 'bg-[#EFEDE8] text-[#131210]'
            }`}
          >
            {/* Message Text */}
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {renderMessageText(message.body)}
            </p>
          </div>
        </div>

        {/* Timestamp & Status */}
        <div className={`flex items-center mt-1.5 px-1 text-[11px] sm:text-xs text-[#9B9890] transition-opacity duration-200 ${
          isOutbound ? 'justify-end' : 'justify-start'
        }`}>
          <span className="font-medium">{formatTimestamp(message.created_at)}</span>

          {isOutbound && (
            <div className="flex items-center">
              {getStatusIcon(message.status, isOptimistic)}

              {!isOptimistic && message.status !== 'sending' && (
                <button
                  onClick={() => setShowDeliveryDetails(!showDeliveryDetails)}
                  className="ml-1.5 p-0.5 text-[#9B9890] hover:text-[#5C5A55] opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded hover:bg-[#F7F6F3]"
                  title="Message details"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Delivery Details Modal */}
        {showDeliveryDetails && (
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
            onClick={() => setShowDeliveryDetails(false)}
          >
            <div
              className="bg-[#FFFFFF] rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-2xl transform transition-all duration-200 animate-scaleIn"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-[#131210]">Message Details</h3>
                <button
                  onClick={() => setShowDeliveryDetails(false)}
                  className="p-1.5 text-[#9B9890] hover:text-[#5C5A55] hover:bg-[#F7F6F3] rounded-lg transition-colors duration-200"
                  aria-label="Close"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="space-y-4">
                {/* Message Preview */}
                <div className="p-3 bg-[#F7F6F3] rounded-xl border border-[#E3E1DB]">
                  <p className="text-sm text-[#5C5A55] line-clamp-3">{message.body}</p>
                </div>

                {/* Status Information */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl">
                    <span className="text-xs text-[#9B9890] font-medium uppercase tracking-wider">Status</span>
                    <div className="flex items-center gap-1.5 mt-1">
                      {message.status === 'delivered' && (
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                      )}
                      {message.status === 'failed' && (
                        <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      )}
                      {message.status === 'sent' && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      )}
                      <p className={`font-semibold capitalize text-sm ${
                        message.status === 'delivered' ? 'text-emerald-600' :
                        message.status === 'failed' ? 'text-red-600' :
                        message.status === 'sent' ? 'text-blue-600' : 'text-[#5C5A55]'
                      }`}>{message.status}</p>
                    </div>
                  </div>

                  <div className="p-3 bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl">
                    <span className="text-xs text-[#9B9890] font-medium uppercase tracking-wider">Sent</span>
                    <p className="text-sm font-semibold text-[#131210] mt-1">{formatTimestamp(message.created_at)}</p>
                  </div>

                  {message.delivered_at && (
                    <div className="p-3 bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl col-span-2">
                      <span className="text-xs text-[#9B9890] font-medium uppercase tracking-wider">Delivered</span>
                      <p className="text-sm font-semibold text-[#131210] mt-1">{formatTimestamp(message.delivered_at)}</p>
                    </div>
                  )}
                </div>

                {/* From/To Information */}
                <div className="pt-3 border-t border-[#E3E1DB]">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[#9B9890] font-medium">From:</span>
                      <p className="text-[#131210] font-mono mt-0.5">{message.from_number}</p>
                    </div>
                    <div>
                      <span className="text-[#9B9890] font-medium">To:</span>
                      <p className="text-[#131210] font-mono mt-0.5">{message.to_number}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Close Button */}
              <button
                onClick={() => setShowDeliveryDetails(false)}
                className="mt-5 w-full py-2.5 bg-[#EFEDE8] hover:bg-[#EFEDE8] text-[#5C5A55] font-medium rounded-xl transition-colors duration-200"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Custom Animations */}
      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 200ms ease-out;
        }

        .animate-scaleIn {
          animation: scaleIn 200ms ease-out;
        }

        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  )
}
