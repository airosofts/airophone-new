'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Searchable single-select dropdown. The option panel is portaled to <body>
// with fixed positioning so a scrolling / overflow-clipped ancestor can never
// clip it, and it flips up when there's no room below.
//
// Props:
//   value, onChange(value)
//   options: [{ value, searchText, ... }]
//   placeholder, error, loading
//   renderSelected(option) → string shown in the input when selected
//   renderOption(option)   → JSX shown for each row in the panel
//   forceDown              → always open the panel below the field (skip flip-up)
export default function SearchableDropdown({ value, onChange, options, placeholder, renderOption, renderSelected, error, loading, forceDown = false }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [rect, setRect] = useState(null)
  const [mounted, setMounted] = useState(false)
  const ref = useRef(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => { setMounted(true) }, [])

  const selected = options.find(o => o.value === value)
  const filtered = options.filter(o => (o.searchText || '').toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    const handler = (e) => {
      if (ref.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false); setSearch('')
    }
    // Capture-phase pointerdown: fires for mouse + touch and BEFORE another
    // handler (e.g. the React Flow canvas) can preventDefault/suppress the
    // event, so an outside click always closes the panel — even when this
    // dropdown lives inside the node canvas. Escape closes it too.
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setSearch('') } }
    document.addEventListener('pointerdown', handler, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', handler, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const measure = () => { if (ref.current) setRect(ref.current.getBoundingClientRect()) }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open])

  const displayValue = open ? search : (selected ? renderSelected(selected) : '')

  let panelStyle = null
  let panelMaxH = 240
  if (rect && typeof window !== 'undefined') {
    const GAP = 6, MARGIN = 12
    const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN
    const spaceAbove = rect.top - GAP - MARGIN
    const openUp = !forceDown && spaceBelow < 200 && spaceAbove > spaceBelow
    panelMaxH = Math.max(120, Math.min(240, openUp ? spaceAbove : spaceBelow))
    panelStyle = {
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      zIndex: 2147483000,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP }),
    }
  }

  return (
    <div className="relative" ref={ref}>
      <div className={`flex items-center border rounded-lg bg-[#FFFFFF] transition-colors ${error ? 'border-[#D63B1F]' : open ? 'border-[#D63B1F] ring-2 ring-[#D63B1F]/20' : 'border-[#D4D1C9]'}`}>
        <svg className="w-4 h-4 text-[#9B9890] ml-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          placeholder={selected ? '' : placeholder}
          onChange={e => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); setSearch('') }}
          className="flex-1 px-3 py-3 text-sm bg-transparent outline-none text-[#131210] placeholder-[#9B9890] min-w-0"
        />
        {selected && !open && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange(''); setSearch('') }} className="p-2 text-[#D4D1C9] hover:text-[#9B9890] flex-shrink-0">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
        )}
        <svg className={`w-4 h-4 text-[#9B9890] mr-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </div>
      {open && mounted && rect && createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg shadow-xl overflow-hidden"
        >
          <div className="overflow-y-auto" style={{ maxHeight: panelMaxH }}>
            {loading ? (
              <p className="px-4 py-4 text-sm text-[#9B9890] text-center">
                <i className="fas fa-spinner fa-spin mr-2" />Loading…
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-4 text-sm text-[#9B9890] text-center">No results found</p>
            ) : filtered.map(o => (
              <button key={o.value} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o.value); setOpen(false); setSearch('') }}
                className={`w-full text-left px-4 py-3 hover:bg-[#F7F6F3] transition-colors border-b border-[#EFEDE8] last:border-0 ${value === o.value ? 'bg-[rgba(214,59,31,0.07)]' : ''}`}>
                {renderOption(o)}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
