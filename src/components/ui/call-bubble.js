'use client'

import { PhoneOutgoing, PhoneIncoming, PhoneMissed, PhoneForwarded } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { isToday, isYesterday, differenceInHours, parseISO } from 'date-fns'

export default function CallBubble({ call }) {
  const isOutbound = call.direction === 'outbound'
  const isForwarded = call.status === 'forwarded'
  const isMissed = call.status === 'missed'
  const isRinging = call.status === 'ringing'
  const isAnswered = call.status === 'answered'
  const isCompleted = call.status === 'completed' || isAnswered

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
    if (mins === 0) return `0:${String(secs).padStart(2, '0')}`
    return `${mins}:${String(secs).padStart(2, '0')}`
  }

  const getTitle = () => {
    if (isForwarded) return isOutbound ? 'Call forwarded' : 'Forwarded call'
    if (isMissed) return isOutbound ? 'No answer' : 'Missed call'
    if (isRinging) return isOutbound ? 'Calling...' : 'Incoming call...'
    if (isCompleted) return isOutbound ? 'Call ended' : 'Incoming call'
    return isOutbound ? 'Call ended' : 'Incoming call'
  }

  const getSubtitle = () => {
    const duration = formatDuration(call.duration_seconds)
    if (isForwarded) return call.forwarded_to ? `Forwarded to ${call.forwarded_to}` : 'Forwarded'
    if (isMissed) return isOutbound ? 'They did not answer' : 'You missed this call'
    if (isRinging) return 'Not answered yet'
    if (isCompleted) {
      const who = isOutbound ? 'You called' : 'They called'
      return duration ? `${who} · ${duration}` : who
    }
    return null
  }

  const getIcon = () => {
    const size = 'w-5 h-5'
    if (isForwarded) return <PhoneForwarded className={size} />
    if (isMissed) return <PhoneMissed className={size} />
    if (isOutbound) return <PhoneOutgoing className={size} />
    return <PhoneIncoming className={size} />
  }

  const getScheme = () => {
    if (isForwarded) return {
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      title: 'text-[#131210]',
      subtitle: 'text-[#5C5A55]',
      border: 'border-[#E3E1DB]',
    }
    if (isMissed) return {
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
      title: 'text-[#131210]',
      subtitle: 'text-[#5C5A55]',
      border: 'border-[#E3E1DB]',
    }
    if (isOutbound) return {
      iconBg: 'bg-[rgba(214,59,31,0.1)]',
      iconColor: 'text-[#D63B1F]',
      title: 'text-[#131210]',
      subtitle: 'text-[#5C5A55]',
      border: 'border-[#E3E1DB]',
    }
    // Inbound answered/completed
    return {
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      title: 'text-[#131210]',
      subtitle: 'text-[#5C5A55]',
      border: 'border-[#E3E1DB]',
    }
  }

  const scheme = getScheme()
  const subtitle = getSubtitle()
  const timestamp = formatTimestamp(call.created_at)

  return (
    <div className="flex justify-center my-3 px-4">
      <div className={`w-full max-w-sm bg-[#FFFFFF] border ${scheme.border} rounded-2xl px-4 py-3 shadow-sm`}>
        <div className="flex items-center gap-3">
          {/* Icon circle */}
          <div className={`w-9 h-9 rounded-full ${scheme.iconBg} flex items-center justify-center shrink-0`}>
            <span className={scheme.iconColor}>{getIcon()}</span>
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${scheme.title} leading-tight`}>{getTitle()}</p>
            {subtitle && (
              <p className={`text-xs ${scheme.subtitle} mt-0.5`}>{subtitle}</p>
            )}
          </div>

          {/* Timestamp */}
          <span className="text-[11px] text-[#9B9890] shrink-0">{timestamp}</span>
        </div>

        {/* Recording player */}
        {call.recording_url && (
          <div className="mt-3 pt-3 border-t border-[#F0EEE9]">
            <audio
              controls
              src={call.recording_url}
              className="w-full"
              style={{ height: 32 }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
