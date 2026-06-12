'use client'

import { useMemo, useRef, useState, useEffect } from 'react'

// All IANA zones when the browser supports it; otherwise a sensible US-first list.
const ALL_TZ = (() => {
  try { if (Intl.supportedValuesOf) return Intl.supportedValuesOf('timeZone') } catch { /* noop */ }
  return ['America/New_York','America/Chicago','America/Denver','America/Phoenix','America/Los_Angeles','America/Anchorage','Pacific/Honolulu','UTC','Europe/London','Europe/Paris']
})()
const BROWSER_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } })()

// y/m/d/hh/mm are WALL-CLOCK fields in `timeZone`; returns the matching UTC Date
// (DST-correct, no external dependency).
function zonedWallToUtc(y, m, d, hh, mm, timeZone) {
  const asUTC = Date.UTC(y, m, d, hh, mm, 0)
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
  const p = dtf.formatToParts(new Date(asUTC))
  const g = (t) => Number(p.find(x => x.type === t).value)
  const shown = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'))
  return new Date(asUTC - (shown - asUTC))
}
// Current wall-clock y/m/d in a timezone.
function todayInTz(timeZone) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date())
  const g = (t) => Number(p.find(x => x.type === t).value)
  return { y: g('year'), m: g('month') - 1, d: g('day') }
}
function fmtPreview(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

// Lightweight custom dropdown (button + popover) — no native <select>.
function Dropdown({ value, label, children, width = 'w-full', align = 'left' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className={`relative ${width}`} ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-[#D4D1C9] rounded-lg text-sm bg-white hover:bg-[#F7F6F3]">
        <span className="truncate">{label}</span>
        <svg className="w-4 h-4 text-[#9B9890] shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
      </button>
      {open && (
        <div className={`absolute z-30 mt-1 ${align === 'right' ? 'right-0' : 'left-0'} min-w-full max-h-60 overflow-y-auto bg-white border border-[#E3E1DB] rounded-xl shadow-xl py-1`}
          onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}
const Item = ({ active, onClick, children }) => (
  <button type="button" onClick={onClick}
    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#F7F6F3] ${active ? 'text-[#D63B1F] font-medium' : 'text-[#131210]'}`}>
    {children}
  </button>
)

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa']
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

export default function ScheduleModal({ open, onClose, onSchedule }) {
  const [tz, setTz] = useState(BROWSER_TZ)
  const [condition, setCondition] = useState('unless_first')
  const [sel, setSel] = useState(null)          // chosen UTC Date
  const [view, setView] = useState(() => { const t = todayInTz(BROWSER_TZ); return { y: t.y, m: t.m } })
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [ampm, setAmpm] = useState('AM')
  const [pickedDay, setPickedDay] = useState(null)   // {y,m,d}

  // Quick presets (computed in the recipient/selected tz).
  const presets = useMemo(() => {
    const t = todayInTz(tz)
    const mk = (y, m, d, hh) => zonedWallToUtc(y, m, d, hh, 0, tz)
    const out = []
    const oneToday = mk(t.y, t.m, t.d, 13)
    if (oneToday.getTime() > Date.now()) out.push({ key: 'today1', label: 'Later today, 1:00 PM', date: oneToday })
    const sevenToday = mk(t.y, t.m, t.d, 19)
    if (sevenToday.getTime() > Date.now()) out.push({ key: 'eve7', label: 'This evening, 7:00 PM', date: sevenToday })
    const tmrw = new Date(Date.UTC(t.y, t.m, t.d + 1))
    out.push({ key: 'tmrw9', label: 'Tomorrow morning, 9:00 AM', date: mk(tmrw.getUTCFullYear(), tmrw.getUTCMonth(), tmrw.getUTCDate(), 9) })
    return out
  }, [tz, open])

  if (!open) return null

  const applyCustom = (day, h12, mm, ap) => {
    if (!day) return
    const hh = (ap === 'PM' ? (h12 % 12) + 12 : (h12 % 12))
    setSel(zonedWallToUtc(day.y, day.m, day.d, hh, mm, tz))
  }

  // Calendar grid for the viewed month.
  const firstDow = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate()
  const today = todayInTz(tz)
  const isPastDay = (d) => (view.y < today.y) || (view.y === today.y && (view.m < today.m || (view.m === today.m && d < today.d)))

  const condLabel = condition === 'unless_first' ? 'unless they message first' : 'even if they message first'

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5">
          <h3 className="text-lg font-semibold text-[#131210]">Schedule message</h3>
          <div className="flex items-center flex-wrap gap-2 mt-1">
            <span className="text-sm text-[#5C5A55]">Send at a later date</span>
            <Dropdown width="w-auto" align="right" label={<span className="text-[#131210] font-medium">{condLabel}</span>}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-[#9B9890]">Schedule condition</div>
              <button type="button" onClick={() => setCondition('unless_first')} className="w-full text-left px-3 py-2 hover:bg-[#F7F6F3]">
                <p className={`text-sm font-medium ${condition === 'unless_first' ? 'text-[#D63B1F]' : 'text-[#131210]'}`}>Unless they message first</p>
                <p className="text-[11px] text-[#9B9890] mt-0.5 max-w-[260px]">If the recipient messages before the scheduled time, the message is canceled and saved as a draft.</p>
              </button>
              <button type="button" onClick={() => setCondition('always')} className="w-full text-left px-3 py-2 hover:bg-[#F7F6F3]">
                <p className={`text-sm font-medium ${condition === 'always' ? 'text-[#D63B1F]' : 'text-[#131210]'}`}>Even if they message first</p>
                <p className="text-[11px] text-[#9B9890] mt-0.5 max-w-[260px]">Your scheduled message is sent even if the recipient messages first.</p>
              </button>
            </Dropdown>
          </div>

          {/* Quick presets */}
          <div className="mt-4 space-y-1.5">
            {presets.map((p) => (
              <button key={p.key} type="button" onClick={() => { setSel(p.date); setPickedDay(null) }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-colors ${sel && Math.abs(sel - p.date) < 1000 ? 'border-[#D63B1F] bg-[#fdecea]' : 'border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}>
                <span className="flex items-center gap-2 text-sm text-[#131210]">
                  <svg className="w-4 h-4 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                  {p.label}
                </span>
                <span className="text-xs text-[#9B9890]">{fmtPreview(p.date, BROWSER_TZ)} your time</span>
              </button>
            ))}
          </div>

          {/* Custom date + time */}
          <div className="mt-4 border border-[#E3E1DB] rounded-xl p-3">
            <p className="text-xs font-semibold text-[#131210] uppercase tracking-wider mb-2">Pick a custom date &amp; time</p>
            {/* Month header */}
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 })} className="p-1.5 rounded-md hover:bg-[#F7F6F3] text-[#5C5A55]">‹</button>
              <span className="text-sm font-medium text-[#131210]">{MONTHS[view.m]} {view.y}</span>
              <button type="button" onClick={() => setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 })} className="p-1.5 rounded-md hover:bg-[#F7F6F3] text-[#5C5A55]">›</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {DOW.map(d => <div key={d} className="text-[10px] text-[#9B9890] py-1">{d}</div>)}
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const d = i + 1
                const past = isPastDay(d)
                const active = pickedDay && pickedDay.y === view.y && pickedDay.m === view.m && pickedDay.d === d
                return (
                  <button key={d} type="button" disabled={past}
                    onClick={() => { const day = { y: view.y, m: view.m, d }; setPickedDay(day); applyCustom(day, hour, minute, ampm) }}
                    className={`text-sm py-1.5 rounded-md ${past ? 'text-[#D4D1C9] cursor-not-allowed' : active ? 'bg-[#D63B1F] text-white' : 'text-[#131210] hover:bg-[#F7F6F3]'}`}>
                    {d}
                  </button>
                )
              })}
            </div>
            {/* Time + timezone */}
            <div className="flex items-center gap-2 mt-3">
              <Dropdown width="w-20" label={String(hour)}>
                {HOURS.map(h => <Item key={h} active={h === hour} onClick={() => { setHour(h); applyCustom(pickedDay, h, minute, ampm) }}>{h}</Item>)}
              </Dropdown>
              <span className="text-[#9B9890]">:</span>
              <Dropdown width="w-20" label={String(minute).padStart(2, '0')}>
                {MINUTES.map(mm => <Item key={mm} active={mm === minute} onClick={() => { setMinute(mm); applyCustom(pickedDay, hour, mm, ampm) }}>{String(mm).padStart(2, '0')}</Item>)}
              </Dropdown>
              <Dropdown width="w-20" label={ampm}>
                {['AM', 'PM'].map(a => <Item key={a} active={a === ampm} onClick={() => { setAmpm(a); applyCustom(pickedDay, hour, minute, a) }}>{a}</Item>)}
              </Dropdown>
            </div>
            <div className="mt-3">
              <Dropdown label={<span className="flex items-center gap-1.5 text-sm"><svg className="w-4 h-4 text-[#9B9890]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>{tz}</span>}>
                {ALL_TZ.map(z => <Item key={z} active={z === tz} onClick={() => setTz(z)}>{z.replace(/_/g, ' ')}</Item>)}
              </Dropdown>
            </div>
          </div>

          <p className="text-[11px] text-[#9B9890] mt-3 bg-[#FBF7E9] border border-[#EFE6C8] rounded-lg p-2.5">
            🌎 Times are shown in the timezone you choose above. Scheduled messages are sent at that moment.
          </p>

          {sel && (
            <p className="text-sm text-[#131210] mt-3">
              Will send <span className="font-semibold">{fmtPreview(sel, tz)}</span>
              <span className="text-[#9B9890]"> ({fmtPreview(sel, BROWSER_TZ)} your time)</span>
            </p>
          )}

          <div className="flex items-center justify-end gap-2 mt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3]">Cancel</button>
            <button type="button" disabled={!sel} onClick={() => onSchedule(sel.toISOString(), tz, condition)}
              className="px-5 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-40">
              Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
