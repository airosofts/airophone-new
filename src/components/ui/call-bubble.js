'use client'

import { PhoneOutgoing, PhoneIncoming, PhoneMissed, PhoneForwarded } from 'lucide-react'
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
    if (isForwarded) return 'Forwarded'
    if (isMissed) return isOutbound ? 'No answer' : 'Missed call'
    if (isCompleted) return isOutbound ? 'Outgoing call' : 'Incoming call'
    return isOutbound ? 'Outgoing call' : 'Incoming call'
  }

  const getIcon = () => {
    if (isForwarded) return <PhoneForwarded className="w-3.5 h-3.5" />
    if (isMissed) return <PhoneMissed className="w-3.5 h-3.5" />
    if (isOutbound) return <PhoneOutgoing className="w-3.5 h-3.5" />
    return <PhoneIncoming className="w-3.5 h-3.5" />
  }

  const getColors = () => {
    if (isForwarded) return { bg: 'bg-blue-50', border: 'border-blue-100', icon: 'text-blue-500', text: 'text-blue-700' }
    if (isMissed) return { bg: 'bg-red-50', border: 'border-red-100', icon: 'text-red-500', text: 'text-red-700' }
    if (isOutbound) return { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-[#C54A3F]', text: 'text-gray-700' }
    return { bg: 'bg-emerald-50', border: 'border-emerald-100', icon: 'text-emerald-500', text: 'text-emerald-700' }
  }

  const duration = formatDuration(call.duration_seconds)
  const colors = getColors()

  // Outbound calls align right (like sent messages), inbound align left
  const alignment = isOutbound ? 'justify-end' : 'justify-start'

  return (
    <div className={`flex ${alignment} my-2`}>
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl border ${colors.bg} ${colors.border}`}>
        <div className={colors.icon}>
          {getIcon()}
        </div>
        <span className={`text-xs font-medium ${colors.text}`}>{getCallLabel()}</span>
        {duration && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-gray-500">{duration}</span>
          </>
        )}
        {isForwarded && call.forwarded_to && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-blue-600">{call.forwarded_to}</span>
          </>
        )}
        <span className="text-[10px] text-gray-400">{formatTimestamp(call.created_at)}</span>
      </div>
    </div>
  )
}
