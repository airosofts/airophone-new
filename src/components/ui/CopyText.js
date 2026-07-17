'use client'

// Hover-to-copy wrapper (WhatsApp-style): the copy icon appears on hover,
// clicking copies `value` and flips to a check for a moment. Wrap any inline
// text — phone numbers in the chat header, contact panel, etc.

import { useState } from 'react'

export default function CopyText({ value, children, className = '' }) {
  const [copied, setCopied] = useState(false)

  const copy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(String(value ?? ''))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable — ignore */ }
  }

  return (
    <span className={`group/copy inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      <span className="truncate">{children ?? value}</span>
      <button
        type="button"
        onClick={copy}
        title={copied ? 'Copied!' : 'Copy'}
        className={`shrink-0 transition-opacity ${copied ? 'opacity-100' : 'opacity-0 group-hover/copy:opacity-100'}`}
      >
        <i className={`fas ${copied ? 'fa-check text-[#1F8C4A]' : 'fa-copy text-[#9B9890] hover:text-[#5C5A55]'} text-[11px]`} />
      </button>
    </span>
  )
}
