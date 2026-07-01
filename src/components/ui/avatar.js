// Small round avatar — profile photo when available, else a colored initials
// circle. Shared by the chat header ("who's managing this chat"), per-message
// sender attribution, and the sidebar team roster.
//
// Pass `online` (boolean) to render a presence dot: green = active on the site,
// grey = offline. Omit it entirely for avatars that have no presence meaning
// (e.g. external contacts).
'use client'

import { useState, useEffect } from 'react'
import { getAvatarColor, getInitials } from '@/lib/avatar-color'

export default function Avatar({ name, seed, phone, photoUrl, size = 24, ring = false, online, bot = false, title, className = '' }) {
  const dim = { width: size, height: size, minWidth: size }
  const ringCls = ring ? 'ring-2 ring-white' : ''

  // Google (and other) profile URLs can 404 / rate-limit / block hotlinking. If
  // the image fails, fall back to initials instead of the browser's broken-image
  // glyph. Reset the flag when the URL changes so a new avatar gets a fresh try.
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => { setImgFailed(false) }, [photoUrl])
  const showPhoto = !!photoUrl && !bot && !imgFailed

  let inner
  if (bot && !photoUrl) {
    // Automated sender (AI reply / follow-up) — a sparkle mark on violet so it
    // reads as "not a person".
    inner = (
      <div
        title={title || name || ''}
        style={{ ...dim, background: '#8b5cf6' }}
        className={`rounded-full flex items-center justify-center text-white ${ringCls} ${className}`}
      >
        {/* Two sparkles — the recognizable "AI" twinkle (free FA has no fa-sparkles) */}
        <svg width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M10 3l1.5 4.2L15.7 8.7 11.5 10.2 10 14.5 8.5 10.2 4.3 8.7 8.5 7.2z" />
          <path d="M17.5 13l.85 2.4 2.4.85-2.4.85-.85 2.4-.85-2.4L14.25 16.25l2.4-.85z" />
        </svg>
      </div>
    )
  } else if (showPhoto) {
    inner = (
      <img
        src={photoUrl}
        alt={name || ''}
        title={title || name || ''}
        style={dim}
        // no-referrer lets Google user-content images load (they block hotlinking
        // when a referrer is sent); onError falls back to the initials circle.
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`rounded-full object-cover ${ringCls} ${className}`}
      />
    )
  } else {
    // `phone` is only the fallback when name is empty/phone-like — it must NOT
    // be the color seed, or getInitials sees name === phone and returns "??".
    const initials = getInitials(name || '', phone || '')
    inner = (
      <div
        title={title || name || ''}
        style={{ ...dim, backgroundColor: getAvatarColor(seed || name || ''), fontSize: Math.max(9, Math.round(size * 0.4)) }}
        className={`rounded-full flex items-center justify-center text-white font-semibold ${ringCls} ${className}`}
      >
        {initials}
      </div>
    )
  }

  if (online === undefined || online === null) return inner

  const dot = Math.max(7, Math.round(size * 0.3))
  return (
    <span className="relative inline-flex shrink-0" style={dim}>
      {inner}
      <span
        title={online ? 'Active now' : 'Offline'}
        style={{
          position: 'absolute', right: -1, bottom: -1,
          width: dot, height: dot, borderRadius: '50%',
          background: online ? '#22c55e' : '#C8C5BD',
          border: '2px solid #FFFFFF', boxSizing: 'content-box',
        }}
      />
    </span>
  )
}
