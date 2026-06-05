'use client'

// Compact status (call-outcome) pill with a dropdown to change it.
// Presentational: calls onChange(statusId | null); the parent persists.
// Used in the Contacts table and the contact-list view modal.

import { useState } from 'react'
import { CONTACT_STATUSES, CONTACT_STATUS_MAP } from '@/lib/contact-status'

export default function ContactStatusPicker({ value, onChange, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const cur = value ? CONTACT_STATUS_MAP[value] : null

  const choose = (e, id) => { e.stopPropagation(); setOpen(false); onChange(id) }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="inline-flex items-center gap-1 text-xs"
      >
        {cur ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: cur.color, background: cur.bg }}>{cur.label}</span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium text-[#9B9890] border border-dashed border-[#D4D1C9]">Set status</span>
        )}
        <svg className="w-3 h-3 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-7 z-20 w-44 bg-white border border-[#E3E1DB] rounded-lg shadow-lg py-1`}>
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
        </>
      )}
    </div>
  )
}
