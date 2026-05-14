'use client'

import { useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { format, differenceInHours, isToday, isYesterday, parseISO } from 'date-fns'

// Official delivery error codes → human-readable reasons.
// Kept in sync with upstream messaging error code reference. Language is
// SaaS-neutral (no upstream provider names exposed to end users).
const ERROR_REASONS = {
  // 1xxxx — Request / auth issues
  '10001': 'Recipient number is inactive',
  '10002': 'Invalid phone number',
  '10003': 'Invalid URL in message',
  '10004': 'Missing required field',
  '10005': 'Resource not found',
  '10006': 'Invalid ID',
  '10007': 'Unexpected error',
  '10009': 'Authentication failed',
  '10010': 'Authorization failed',
  '10011': 'Too many requests',
  '10015': 'Bad request',
  '10016': 'Phone number must be in +E.164 format',
  // 2xxxx — Account
  '20002': 'API key revoked',
  '20006': 'Expired access token',
  '20012': 'Account inactive',
  '20013': 'Account blocked',
  '20014': 'Account unverified',
  '20015': 'Feature not enabled',
  '20016': 'Account verification required',
  '20017': 'Account verification required',
  '20100': 'Insufficient credits',
  // 4xxxx — Delivery
  '40001': 'Not routable',
  '40002': 'Blocked as spam (temporary)',
  '40003': 'Blocked as spam (permanent)',
  '40004': 'Rejected by recipient network',
  '40005': 'Message expired during transmission',
  '40006': 'Recipient network unavailable',
  '40008': 'Undeliverable',
  '40009': 'Invalid message body',
  '40010': 'Unregistered 10DLC message',
  '40011': 'Too many requests',
  '40012': 'Invalid destination number',
  '40013': 'Invalid sender number',
  '40014': 'Message expired in queue',
  '40015': 'Blocked as spam',
  '40016': 'T-Mobile 10DLC sending limit reached',
  '40017': 'AT&T 10DLC spam rejection',
  '40018': 'AT&T 10DLC sending limit reached',
  '40100': 'Number not enabled for messaging',
  '40150': 'Toll-free number not in registry',
  '40151': 'Number enablement pending with other provider',
  '40300': 'Blocked — recipient sent STOP',
  '40301': 'Unsupported message type for recipient',
  '40302': 'Message too large',
  '40304': 'Invalid combination of message content',
  '40305': 'Invalid sender number',
  '40306': 'Alpha sender not configured',
  '40308': 'Invalid sender for MMS',
  '40309': 'Invalid destination region',
  '40310': 'Invalid recipient number',
  '40311': 'Invalid messaging profile secret',
  '40312': 'Messaging profile disabled',
  '40313': 'Missing messaging profile secret',
  '40314': 'Messaging disabled on account',
  '40315': 'Unhealthy sender number',
  '40316': 'No message content provided',
  '40317': 'Invalid MMS content',
  '40318': 'Message queue full',
  '40319': 'Incompatible message type for recipient',
  '40320': 'Temporarily unusable sender number',
  '40321': 'No usable numbers on profile',
  '40322': 'Blocked due to content',
  '40328': 'SMS exceeds recommended size',
  '40329': 'Toll-free number not yet verified',
  // Internal sentinels (never shown to user as a code chip)
  'sending_failed': 'Message rejected by network',
  'delivery_failed': 'Could not be delivered',
  'delivery_unconfirmed': 'Delivery could not be confirmed',
  'telnyx_record_expired': 'Delivery record expired',
}

function lookupErrorReason(code, fallback) {
  if (!code) return fallback || 'Could not be delivered'
  const c = String(code).trim()
  return ERROR_REASONS[c] || fallback || `Error code ${c}`
}

export default function MessageBubble({ message, user }) {
  const [showDeliveryDetails, setShowDeliveryDetails] = useState(false)
  const isOutbound = message.direction === 'outbound'
  const isOptimistic = message.isOptimistic
  const isFailed = isOutbound && (message.status === 'failed' || message.status === 'undelivered')
  const isVoicemail = message.type === 'voicemail' && !!message.recording_url

  // Prefer the dedicated columns; fall back to the old error_details JSON
  // for messages that pre-date the migration.
  const errorParsed = (() => {
    try {
      return typeof message.error_details === 'string'
        ? JSON.parse(message.error_details)
        : message.error_details
    } catch { return null }
  })()
  const errorCode = message.error_code || errorParsed?.error_code || null
  const errorMessage = message.error_message || errorParsed?.error_message || null
  const reconciledAt = errorParsed?.reconciled_at || null
  const failureReason = isFailed
    ? lookupErrorReason(errorCode, errorMessage)
    : null
  // Show the code chip for real carrier codes; hide internal sentinels.
  const INTERNAL_SENTINELS = new Set(['unknown', 'telnyx_record_expired'])
  const displayCode =
    errorCode
    && !INTERNAL_SENTINELS.has(String(errorCode))
    && !String(errorCode).startsWith('finalized_')
      ? String(errorCode)
      : null


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
          className={
            isOutbound
              ? (isFailed
                  ? 'underline text-[#D63B1F] hover:text-[#c23119] break-all'
                  : 'underline text-white/90 hover:text-white break-all')
              : 'underline text-[#D63B1F] hover:text-[#c23119] break-all'
          }
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
            className={`${isVoicemail ? 'px-3 py-2.5' : 'px-3 py-2 sm:px-3.5 sm:py-2.5'} rounded-2xl relative ${
              isOutbound
                ? isFailed
                  ? 'bg-[rgba(214,59,31,0.06)] text-[#131210] border border-[rgba(214,59,31,0.22)]'
                  : isVoicemail
                    ? `bg-[#F7F6F3] text-[#131210] border border-[#E3E1DB] ${isOptimistic ? 'opacity-60' : ''}`
                    : `bg-[#D63B1F] text-white ${isOptimistic ? 'opacity-60' : ''}`
                : 'bg-[#EFEDE8] text-[#131210]'
            }`}
          >
            {isVoicemail ? (
              <div className="flex items-center gap-3 min-w-60">
                <div className="shrink-0 w-9 h-9 rounded-full bg-[rgba(214,59,31,0.08)] border border-[rgba(214,59,31,0.18)] flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D63B1F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="14" r="4"/><circle cx="18" cy="14" r="4"/><line x1="6" y1="18" x2="18" y2="18"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider mb-1">Voicemail</p>
                  <audio
                    src={message.recording_url}
                    controls
                    preload="none"
                    className="w-full h-8"
                    style={{ maxWidth: 260 }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
                {renderMessageText(message.body)}
              </p>
            )}
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

        {/* "Not delivered" pill — only shown for failed outbound messages */}
        {isFailed && (
          <div className={`mt-1.5 flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
            <button
              onClick={() => setShowDeliveryDetails(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.18)] text-[11.5px] text-[#D63B1F] hover:bg-[rgba(214,59,31,0.11)] transition-colors cursor-pointer max-w-full tracking-tight"
              title="Tap for full details"
              style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", letterSpacing: '-0.005em' }}
            >
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="font-semibold">Not delivered</span>
              {displayCode && (
                <span className="font-mono text-[10px] font-semibold px-1.5 py-px rounded bg-[rgba(214,59,31,0.12)] text-[#D63B1F] tracking-normal">
                  {displayCode}
                </span>
              )}
              <span className="text-[#D63B1F]/75 truncate hidden sm:inline">{failureReason}</span>
            </button>
          </div>
        )}


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
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl">
                    <span className="text-[10.5px] text-[#9B9890] font-semibold uppercase tracking-[0.06em]">Status</span>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{
                        background:
                          message.status === 'delivered' ? '#16a34a' :
                          message.status === 'failed' ? '#D63B1F' :
                          message.status === 'sent' ? '#5C5A55' : '#D4D1C9'
                      }} />
                      <p className="font-semibold capitalize text-sm tracking-tight" style={{
                        color:
                          message.status === 'delivered' ? '#16a34a' :
                          message.status === 'failed' ? '#D63B1F' :
                          message.status === 'sent' ? '#131210' : '#5C5A55'
                      }}>{message.status}</p>
                    </div>
                  </div>

                  <div className="p-3 bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl">
                    <span className="text-[10.5px] text-[#9B9890] font-semibold uppercase tracking-[0.06em]">Sent</span>
                    <p className="text-sm font-semibold text-[#131210] mt-1.5 tracking-tight">{formatTimestamp(message.created_at)}</p>
                  </div>

                  {message.delivered_at && (
                    <div className="p-3 bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl col-span-2">
                      <span className="text-[10.5px] text-[#9B9890] font-semibold uppercase tracking-[0.06em]">Delivered</span>
                      <p className="text-sm font-semibold text-[#131210] mt-1.5 tracking-tight">{formatTimestamp(message.delivered_at)}</p>
                    </div>
                  )}

                  {isFailed && failureReason && (
                    <div className="p-3.5 bg-[rgba(214,59,31,0.06)] border border-[rgba(214,59,31,0.18)] rounded-xl col-span-2">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10.5px] text-[#D63B1F] font-semibold uppercase tracking-[0.06em]">Failure reason</span>
                        {displayCode && (
                          <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[rgba(214,59,31,0.12)] text-[#D63B1F]">
                            CODE {displayCode}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-[#D63B1F] tracking-tight">{failureReason}</p>
                      {reconciledAt && (
                        <p className="text-[11px] text-[#D63B1F]/70 mt-1">Verified {formatTimestamp(reconciledAt)}</p>
                      )}
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
                className="mt-3 w-full py-2.5 bg-[#EFEDE8] hover:bg-[#E3E1DB] text-[#131210] font-semibold rounded-xl transition-colors duration-200 tracking-tight"
                style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
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
