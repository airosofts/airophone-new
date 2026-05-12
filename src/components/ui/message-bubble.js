'use client'

import { useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { format, differenceInHours, isToday, isYesterday, parseISO } from 'date-fns'

// Telnyx delivery error codes → human-readable reasons.
// Source: https://developers.telnyx.com/docs/messaging/troubleshooting/delivery-error-codes
const TELNYX_ERRORS = {
  '30001': 'Queue overflow',
  '30002': 'Account suspended',
  '30003': 'Handset unreachable',
  '30004': 'Message blocked by recipient',
  '30005': 'Unknown destination',
  '30006': 'Landline or unreachable carrier',
  '30007': 'Carrier filtered (likely spam-flagged)',
  '30008': 'Carrier rejected the message',
  '30009': 'Missing inbound segment',
  '40001': 'Invalid messaging profile',
  '40002': 'Outbound profile is disabled',
  '40003': 'Insufficient permissions for this number',
  '40010': 'Number not registered for messaging',
  '40300': 'Number is not 10DLC-registered',
  'sending_failed': 'Carrier rejected the message',
  'delivery_failed': 'Could not be delivered to recipient',
  'delivery_unconfirmed': 'Delivery could not be confirmed by carrier',
  'telnyx_record_expired': 'Telnyx record expired (>10 days old)',
}

function lookupErrorReason(code, fallback) {
  if (!code) return fallback || 'Message could not be delivered'
  const c = String(code).trim()
  return TELNYX_ERRORS[c] || fallback || `Error code ${c}`
}

export default function MessageBubble({ message, user }) {
  const [showDeliveryDetails, setShowDeliveryDetails] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileResult, setReconcileResult] = useState(null)
  const isOutbound = message.direction === 'outbound'
  const isOptimistic = message.isOptimistic
  const isFailed = isOutbound && (message.status === 'failed' || message.status === 'undelivered')

  // Parse error_details once — used for both failed and "unverifiable" states.
  const errorParsed = (() => {
    try {
      return typeof message.error_details === 'string'
        ? JSON.parse(message.error_details)
        : message.error_details
    } catch { return null }
  })()
  const errorCode = errorParsed?.error_code || null
  const isUnverifiable = isOutbound
    && !isFailed
    && message.status === 'sent'
    && errorCode === 'telnyx_record_expired'
  const failureReason = isFailed
    ? lookupErrorReason(errorCode, errorParsed?.error_message)
    : null
  // Only show numeric code chips (e.g. "30007") — skip our internal sentinel strings.
  const displayCode = errorCode && /^\d+$/.test(String(errorCode)) ? errorCode : null

  const handleRecheck = async () => {
    setReconciling(true)
    setReconcileResult(null)
    try {
      const session = JSON.parse(localStorage.getItem('user_session') || '{}')
      const res = await fetch('/api/messages/reconcile-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': session.userId || '',
          'x-workspace-id': session.workspaceId || '',
        },
        body: JSON.stringify({ messageId: message.id }),
      })
      const data = await res.json()
      setReconcileResult(data.results?.[0] || { action: 'no_op' })
    } catch (err) {
      setReconcileResult({ action: 'error', error: err.message })
    } finally {
      setReconciling(false)
    }
  }

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
            className={`px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-2xl relative ${
              isOutbound
                ? isFailed
                  ? 'bg-[rgba(214,59,31,0.06)] text-[#131210] border border-[rgba(214,59,31,0.22)]'
                  : `bg-[#D63B1F] text-white ${isOptimistic ? 'opacity-60' : ''}`
                : 'bg-[#EFEDE8] text-[#131210]'
            }`}
          >
            {/* Message Text */}
            <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
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

        {/* "Delivery unverified" pill — message is too old for Telnyx to confirm */}
        {isUnverifiable && (
          <div className={`mt-1.5 flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
            <button
              onClick={() => setShowDeliveryDetails(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F7F6F3] border border-[#E3E1DB] text-[11.5px] text-[#5C5A55] hover:bg-[#EFEDE8] transition-colors cursor-pointer max-w-full tracking-tight"
              title="Tap for details"
              style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", letterSpacing: '-0.005em' }}
            >
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" />
              </svg>
              <span className="font-semibold text-[#131210]">Delivery unverified</span>
              <span className="text-[#9B9890] truncate hidden sm:inline">record too old to confirm</span>
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
                      {errorParsed?.reconciled_at && (
                        <p className="text-[11px] text-[#D63B1F]/70 mt-1">Verified {formatTimestamp(errorParsed.reconciled_at)}</p>
                      )}
                    </div>
                  )}

                  {isUnverifiable && (
                    <div className="p-3.5 bg-[#F7F6F3] border border-[#E3E1DB] rounded-xl col-span-2">
                      <span className="text-[10.5px] text-[#9B9890] font-semibold uppercase tracking-[0.06em]">Delivery status</span>
                      <p className="text-sm font-semibold text-[#131210] mt-1.5 tracking-tight">Could not be verified</p>
                      <p className="text-[12px] text-[#5C5A55] mt-1 leading-relaxed">Telnyx no longer keeps a record of this message (older than ~10 days). The original delivery state is unknown.</p>
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

              {/* Re-check delivery (only for outbound messages with a Telnyx ID) */}
              {isOutbound && message.telnyx_message_id && (
                <div className="mt-4 p-3.5 bg-[#F7F6F3] border border-[#E3E1DB] rounded-xl">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-[#131210] tracking-tight">Re-check from Telnyx</p>
                      <p className="text-[11.5px] text-[#9B9890] mt-0.5 leading-relaxed">Pulls the real delivery state directly from the carrier</p>
                    </div>
                    <button
                      onClick={handleRecheck}
                      disabled={reconciling}
                      className="shrink-0 px-3.5 py-1.5 text-[12px] font-semibold text-white bg-[#131210] hover:bg-[#3a3833] rounded-lg disabled:opacity-50 transition-colors tracking-tight"
                      style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
                    >
                      {reconciling ? 'Checking…' : 'Re-check'}
                    </button>
                  </div>
                  {reconcileResult && (
                    <div className="mt-3 pt-3 border-t border-[#E3E1DB] space-y-1.5">
                      {reconcileResult.telnyx_status && (
                        <div className="flex items-center justify-between text-[11.5px]">
                          <span className="text-[#9B9890]">Telnyx status</span>
                          <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#EFEDE8] text-[#131210]">{reconcileResult.telnyx_status}</span>
                        </div>
                      )}
                      {reconcileResult.new_status && (
                        <div className="flex items-center justify-between text-[11.5px]">
                          <span className="text-[#9B9890]">Updated to</span>
                          <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[rgba(214,59,31,0.07)] text-[#D63B1F]">{reconcileResult.new_status}</span>
                        </div>
                      )}
                      {reconcileResult.action === 'telnyx_404' && (
                        <p className="text-[11.5px] text-[#5C5A55] leading-relaxed">Telnyx no longer has this record (&gt;10 days old). Tagged as unverified.</p>
                      )}
                      {reconcileResult.action === 'skipped_non_terminal' && (
                        <p className="text-[11.5px] text-[#5C5A55] leading-relaxed">Still in flight — Telnyx hasn&rsquo;t confirmed final state yet. Try again in a moment.</p>
                      )}
                      {reconcileResult.error && (
                        <p className="text-[11.5px] text-[#D63B1F] leading-relaxed">{reconcileResult.error}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

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
