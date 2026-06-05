'use client'

// Compact status (call-outcome) pill with a CUSTOM dropdown to change it.
// The menu renders into a portal with fixed positioning so it never gets
// clipped by a table's overflow container. Presentational: calls
// onChange(statusId | null); the parent persists. Used in the inbox panel,
// the Contacts table, and the contact-list view modal.

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CONTACT_STATUSES, CONTACT_STATUS_MAP } from '@/lib/contact-status'

const MENU_W = 184

export default function ContactStatusPicker({ value, onChange, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const cur = value ? CONTACT_STATUS_MAP[value] : null

  const toggle = (e) => {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const left = align === 'right' ? r.right - MENU_W : r.left
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8)) })
    }
    setOpen(true)
  }
  const choose = (e, id) => { e.stopPropagation(); setOpen(false); onChange(id) }

  return (
    <div className="inline-block">
      <button ref={btnRef} type="button" onClick={toggle} className="inline-flex items-center gap-1 text-xs">
        {cur ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: cur.color, background: cur.bg }}>{cur.label}</span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium text-[#9B9890] border border-dashed border-[#D4D1C9]">Set status</span>
        )}
        <svg className="w-3 h-3 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div
            className="fixed z-[91] bg-white border border-[#E3E1DB] rounded-lg shadow-lg py-1 max-h-[320px] overflow-y-auto"
            style={{ top: pos.top, left: pos.left, width: MENU_W }}
          >
            {CONTACT_STATUSES.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={(e) => choose(e, s.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[#F7F6F3] ${value === s.id ? 'bg-[#F7F6F3]' : ''}`}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <span className="text-[#131210]">{s.label}</span>
              </button>
            ))}
            {value && (
              <>
                <div className="border-t border-[#F0EEE9] my-1" />
                <button type="button" onClick={(e) => choose(e, null)} className="w-full text-left px-3 py-1.5 text-sm text-[#9B9890] hover:bg-[#F7F6F3]">Clear status</button>
              </>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
