'use client'

import { formatInTimeZone } from 'date-fns-tz'
import { isToday, isYesterday, differenceInHours, parseISO } from 'date-fns'

export default function CallBubble({ call }) {
  const isOutbound = call.direction === 'outbound'
  const isForwarded = call.status === 'forwarded'
  const isMissed = call.status === 'missed'
  const isCompleted = call.status === 'completed' || call.status === 'answered'

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return ''
    const timezone = 'America/New_York'
    const date = parseISO(timestamp)
    if (isToday(date)) return formatInTimeZone(date, timezone, 'h:mm a')
    if (isYesterday(date)) return 'Yesterday ' + formatInTimeZone(date, timezone, 'h:mm a')
    if (differenceInHours(new Date(), date) < 168) return formatInTimeZone(date, timezone, 'EEE h:mm a')
    return formatInTimeZone(date, timezone, 'MMM d h:mm a')
  }

  const formatDuration = (seconds) => {
    if (!seconds || seconds <= 0) return null
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins === 0) return `${secs}s`
    return `${mins}m ${secs}s`
  }

  const getCallLabel = () => {
    if (isForwarded) return 'Forwarded call'
    if (isMissed) return isOutbound ? 'No answer' : 'Missed call'
    if (isCompleted) return isOutbound ? 'Outgoing call' : 'Incoming call'
    if (call.status === 'initiated' || call.status === 'ringing') return isOutbound ? 'Outgoing call' : 'Incoming call'
    return isOutbound ? 'Outgoing call' : 'Incoming call'
  }

  const getIconColor = () => {
    if (isForwarded) return 'text-blue-500'
    if (isMissed) return 'text-red-500'
    return 'text-emerald-500'
  }

  const getBgColor = () => {
    if (isForwarded) return 'bg-blue-50 border-blue-200'
    if (isMissed) return 'bg-red-50 border-red-200'
    return 'bg-gray-50 border-gray-200'
  }

  const duration = formatDuration(call.duration_seconds)

  return (
    <div className="flex justify-center my-3">
      <div className={`inline-flex items-center gap-2.5 px-4 py-2 rounded-full border ${getBgColor()} max-w-sm`}>
        {/* Call icon */}
        <div className={`flex-shrink-0 ${getIconColor()}`}>
          {isForwarded ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="14" y1="10" x2="21" y2="3" />
            </svg>
          ) : isMissed ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0119 12.55m-5 0a6.94 6.94 0 00-1.5-.2" />
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
            </svg>
          ) : isOutbound ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="14" y1="10" x2="21" y2="3" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="10" y1="14" x2="3" y2="21" />
            </svg>
          )}
        </div>

        {/* Call info */}
        <div className="flex items-center gap-1.5 text-xs text-gray-700">
          <span className="font-medium">{getCallLabel()}</span>
          {duration && (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500">{duration}</span>
            </>
          )}
          {isForwarded && call.forwarded_to && (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-blue-600">{call.forwarded_to}</span>
            </>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-[10px] text-gray-400 ml-1">{formatTimestamp(call.created_at)}</span>
      </div>
    </div>
  )
}
