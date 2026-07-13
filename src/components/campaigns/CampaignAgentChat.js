'use client'

// Campaign AI builder — outbound sibling of ScenarioAgentChat (kept separate; the
// scenario builder is untouched). Hybrid: the LLM writes only the NAME + MESSAGE;
// everything else is a deterministic widget queue. The AI-model picker is a
// ChatGPT-style dropdown INSIDE the composer (chosen from the start). No Review
// step — the last question creates the draft and routes to the campaigns list.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { fetchWithWorkspace } from '@/lib/api-client'
import SearchableDropdown from '@/components/SearchableDropdown'

const post = (url, body) => fetchWithWorkspace(url, { method: 'POST', body: JSON.stringify(body) })
const getJSON = (url) => fetchWithWorkspace(url).then(r => r.json()).catch(() => ({}))
// /api/phone-numbers returns the number as camelCase `phoneNumber`; snake_case fallback.
const phoneOf = (p) => p?.phoneNumber || p?.phone_number || ''

const SUGGESTIONS = [
  "Promote this Saturday's open house at 123 Oak St to my seller leads",
  'Win back leads who went quiet — offer a quick call this week',
  'Announce a price drop and invite buyers to book a showing',
]
const ENGAGEMENT_OPTS = [
  { v: 'all', label: 'Everyone on the list' },
  { v: 'not_replied', label: "Haven't replied yet" },
  { v: 'not_replied_recent', label: 'Quiet for a while' },
  { v: 'never_messaged', label: 'Brand-new (never texted from this line)' },
]
const WINDOW_OPTS = [[24, '24 hours'], [72, '3 days'], [168, '7 days'], [720, '30 days']]
const stageOrder = (source) => ['sender', 'source', 'audience', ...(source === 'contacts' ? ['engagement'] : []), 'schedule', 'pace', 'create']

function buildTimeOptions() {
  const out = []
  for (let h = 0; h < 24; h++) for (const m of [0, 30]) {
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const hr = h % 12 === 0 ? 12 : h % 12
    const label = `${hr}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
    out.push({ value, label, searchText: label })
  }
  return out
}

// Styled calendar — pick ANY date of ANY month; past days are disabled.
// value / onChange use 'YYYY-MM-DD'.
const pad2 = (n) => String(n).padStart(2, '0')
function DatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => (value ? new Date(`${value}T00:00:00`) : new Date()))
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [])

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const y = view.getFullYear(), m = view.getMonth()
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7   // Monday-first
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const selLabel = value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 border rounded-lg bg-white px-3 py-3 text-sm transition-colors ${open ? 'border-[#D63B1F] ring-2 ring-[#D63B1F]/20' : 'border-[#D4D1C9]'}`}>
        <span className={selLabel ? 'text-[#131210]' : 'text-[#9B9890]'}>{selLabel || 'Pick a date…'}</span>
        <i className="fas fa-calendar-day text-[#9B9890] text-xs" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-30 bg-white border border-[#E3E1DB] rounded-xl shadow-xl p-3 w-72">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#F7F6F3] text-[#5C5A55]"><i className="fas fa-chevron-left text-xs" /></button>
            <span className="text-sm font-semibold text-[#131210]">{view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
            <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#F7F6F3] text-[#5C5A55]"><i className="fas fa-chevron-right text-xs" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <div key={d} className="text-center text-[10px] font-medium text-[#9B9890] py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (!d) return <div key={i} />
              const val = `${y}-${pad2(m + 1)}-${pad2(d)}`
              const dObj = new Date(y, m, d)
              const isPast = dObj < today
              const isSel = value === val
              const isToday = dObj.getTime() === today.getTime()
              return (
                <button key={i} type="button" disabled={isPast} onClick={() => { onChange(val); setOpen(false) }}
                  className={`h-8 rounded-lg text-sm transition-colors ${isSel ? 'bg-[#D63B1F] text-white font-semibold' : isPast ? 'text-[#D4D1C9] cursor-not-allowed' : 'text-[#131210] hover:bg-[#F7F6F3]'} ${isToday && !isSel ? 'ring-1 ring-[#D63B1F]/40' : ''}`}>
                  {d}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2.5 border border-[#D4D1C9] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]'
const labelCls = 'block text-[11px] font-semibold text-[#9B9890] uppercase tracking-wide mb-1.5'
const contBtn = 'mt-3 w-full bg-[#131210] hover:bg-[#3C3A35] text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50 transition-colors'

function TypingDots() {
  return <span className="inline-flex gap-1">{[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#B5B2AA] animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />)}</span>
}

function Card({ title, subtitle, children }) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] bg-white rounded-2xl rounded-bl-md border border-[#E3E1DB] shadow-sm p-4">
        <p className="text-sm font-semibold text-[#131210]">{title}</p>
        {subtitle && <p className="text-xs text-[#9B9890] mt-0.5 mb-1">{subtitle}</p>}
        <div className="mt-2">{children}</div>
      </div>
    </div>
  )
}
function Done({ label, value, onChange }) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-[#F3F7F4] border border-[#E3E1DB]">
        <span className="text-xs text-[#5C5A55]"><b className="text-[#131210]">{label}:</b> {value}</span>
        {onChange && <button onClick={onChange} className="text-[11px] font-semibold text-[#D63B1F] hover:underline shrink-0">Change</button>}
      </div>
    </div>
  )
}
function Pills({ options, value, onPick }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button key={o.v} onClick={() => onPick(o.v)}
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${value === o.v ? 'bg-[#131210] text-white border-[#131210]' : 'bg-white text-[#5C5A55] border-[#D4D1C9] hover:border-[#131210]'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ChatGPT-style model dropdown that lives inside the composer.
function ModelPicker({ models, value, onChange, locked }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [])
  const cur = models.find(m => m.id === value)
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => !locked && setOpen(o => !o)} disabled={locked}
        title={locked ? 'The model is locked once the chat starts' : undefined}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#5C5A55] enabled:hover:bg-[#F7F6F3] border border-transparent enabled:hover:border-[#E3E1DB] transition-colors disabled:cursor-default">
        <i className="fas fa-microchip text-[10px] text-[#9B9890]" />
        <span className="max-w-[120px] truncate">{cur ? `${cur.vendor} ${cur.label}` : 'Model'}</span>
        <i className={`fas ${locked ? 'fa-lock' : 'fa-chevron-down'} text-[9px] text-[#9B9890]`} />
      </button>
      {open && !locked && (
        <div className="absolute top-full left-0 mt-1.5 w-60 bg-white border border-[#E3E1DB] rounded-xl shadow-lg py-1 z-30">
          <p className="px-3 py-1.5 text-[10px] font-semibold text-[#9B9890] uppercase tracking-wide">Model</p>
          {models.map(m => (
            <button key={m.id} disabled={!m.available} onClick={() => { onChange(m.id); setOpen(false) }}
              className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#F7F6F3] disabled:opacity-40 disabled:cursor-not-allowed">
              <span className="text-[#131210]">{m.vendor} · {m.label}{m.isDefault ? '  · Default' : ''}</span>
              {value === m.id ? <i className="fas fa-check text-[#D63B1F] text-[10px]" /> : (!m.available && <span className="text-[9px] text-[#9B9890]">key needed</span>)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Composer({ rows, placeholder, input, setInput, onSend, busy, models, model, setModel, locked }) {
  return (
    <div className="bg-white border border-[#E3E1DB] rounded-2xl shadow-sm focus-within:border-[#D63B1F] focus-within:ring-2 focus-within:ring-[#D63B1F]/10">
      <textarea value={input} onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
        rows={rows} placeholder={placeholder}
        className="w-full px-4 pt-3.5 pb-1 text-sm text-[#131210] placeholder-[#9B9890] bg-transparent rounded-2xl resize-none focus:outline-none" />
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
        <ModelPicker models={models} value={model} onChange={setModel} locked={locked} />
        <button type="button" onClick={onSend} disabled={busy || !input.trim()} title="Send"
          className="w-8 h-8 rounded-full bg-[#D63B1F] hover:bg-[#c23119] text-white flex items-center justify-center disabled:opacity-40 shrink-0">
          <i className="fas fa-arrow-up text-xs" />
        </button>
      </div>
    </div>
  )
}

export default function CampaignAgentChat({ onSwitchToManual, inline = false, onCreated, headerTabs = null }) {
  const router = useRouter()
  const bottomRef = useRef(null)

  const [models, setModels] = useState([])
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [contactLists, setContactLists] = useState([])
  const [mondayConnected, setMondayConnected] = useState(false)
  const [sheetsConnected, setSheetsConnected] = useState(false)
  const [boards, setBoards] = useState([])
  const [boardColumns, setBoardColumns] = useState([])
  const [spreadsheets, setSpreadsheets] = useState([])
  const [tabs, setTabs] = useState([])
  const [sheetColumns, setSheetColumns] = useState([])
  // loading flags so the dropdowns can show a spinner while data is fetching
  const [loadingLookups, setLoadingLookups] = useState(true)
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [loadingBoardCols, setLoadingBoardCols] = useState(false)
  const [loadingSpreadsheets, setLoadingSpreadsheets] = useState(false)
  const [loadingTabs, setLoadingTabs] = useState(false)
  const [loadingSheetCols, setLoadingSheetCols] = useState(false)

  const [model, setModel] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ name: '', message: '' })
  const [promptAccepted, setPromptAccepted] = useState(false)

  const [stage, setStage] = useState('sender')
  const [senderId, setSenderId] = useState('')
  const [source, setSource] = useState('')
  const [contactListId, setContactListId] = useState('')
  const [mondayBoardId, setMondayBoardId] = useState('')
  const [mondayPhoneCol, setMondayPhoneCol] = useState('')
  const [sheetId, setSheetId] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [sheetTabGid, setSheetTabGid] = useState(null)
  const [sheetPhoneCol, setSheetPhoneCol] = useState('')
  const [engagement, setEngagement] = useState('all')
  const [windowHours, setWindowHours] = useState(72)
  const [scheduleType, setScheduleType] = useState('immediate')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleClock, setScheduleClock] = useState('')
  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(false)
  const [dailyCap, setDailyCap] = useState(500)
  const [businessHoursOnly, setBusinessHoursOnly] = useState(false)
  const [recurring, setRecurring] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    (async () => {
      const [m, p, cl, mon, sh] = await Promise.all([
        getJSON('/api/ai-models'), getJSON('/api/phone-numbers'), getJSON('/api/contact-lists'),
        getJSON('/api/integrations/monday'), getJSON('/api/integrations/google-sheets'),
      ])
      const ml = m?.models || []
      setModels(ml)
      const def = ml.find(x => x.isDefault && x.available) || ml.find(x => x.available)
      if (def) setModel(def.id)
      setPhoneNumbers(p?.phoneNumbers || [])
      setContactLists(cl?.contactLists || cl?.lists || (Array.isArray(cl) ? cl : []))
      setMondayConnected(!!mon?.connected)
      setSheetsConnected(!!sh?.connected)
      setLoadingLookups(false)
    })()
  }, [])

  useEffect(() => {
    if (source !== 'monday' || boards.length > 0) return
    setLoadingBoards(true)
    getJSON('/api/integrations/monday/boards').then(d => setBoards(d?.boards || [])).finally(() => setLoadingBoards(false))
  }, [source, boards.length])
  useEffect(() => {
    if (source !== 'sheets' || spreadsheets.length > 0) return
    setLoadingSpreadsheets(true)
    getJSON('/api/integrations/google-sheets/spreadsheets').then(d => setSpreadsheets(d?.spreadsheets || [])).finally(() => setLoadingSpreadsheets(false))
  }, [source, spreadsheets.length])
  useEffect(() => {
    if (!mondayBoardId) { setBoardColumns([]); return }
    setLoadingBoardCols(true)
    getJSON(`/api/integrations/monday/boards/${mondayBoardId}/columns`).then(d => setBoardColumns(d?.columns || [])).finally(() => setLoadingBoardCols(false))
  }, [mondayBoardId])
  useEffect(() => {
    if (!sheetId) { setTabs([]); return }
    setLoadingTabs(true)
    getJSON(`/api/integrations/google-sheets/spreadsheets/${sheetId}/tabs`).then(d => setTabs(d?.tabs || [])).finally(() => setLoadingTabs(false))
  }, [sheetId])
  useEffect(() => {
    if (!sheetId || !sheetName) { setSheetColumns([]); return }
    setLoadingSheetCols(true)
    getJSON(`/api/integrations/google-sheets/spreadsheets/${sheetId}/columns?sheet=${encodeURIComponent(sheetName)}`).then(d => setSheetColumns(d?.columns || [])).finally(() => setLoadingSheetCols(false))
  }, [sheetId, sheetName])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, promptAccepted, stage, draft, busy])

  const applySettings = useCallback((s) => {
    if (!s) return
    if (s.sender_number_id) setSenderId(String(s.sender_number_id))
    if (s.source) setSource(s.source)
    if (Array.isArray(s.contact_list_ids) && s.contact_list_ids[0]) setContactListId(String(s.contact_list_ids[0]))
    if (s.engagement) setEngagement(s.engagement)
  }, [])

  const sendDescribe = async () => {
    const text = input.trim()
    if (!text || busy) return
    setError(''); setInput('')
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next); setBusy(true)
    try {
      const res = await post('/api/campaigns/builder-chat', { messages: next, current: draft, model })
      const d = await res.json()
      if (!res.ok || !d.success) throw new Error(d.error || 'The assistant could not respond.')
      setDraft({ name: d.name, message: d.message })
      applySettings(d.settings)
      setMessages(m => [...m, { role: 'assistant', content: d.reply }])
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const order = stageOrder(source)
  const idx = (s) => order.indexOf(s)
  const stepState = (s) => (idx(s) < idx(stage) ? 'done' : idx(s) === idx(stage) ? 'active' : 'pending')
  const advance = (from) => { const o = stageOrder(source); setStage(o[o.indexOf(from) + 1] || 'create') }

  const senderLabel = () => { const p = phoneNumbers.find(x => String(x.id) === String(senderId)); return p ? (p.custom_name ? `${p.custom_name} (${phoneOf(p)})` : phoneOf(p)) : '—' }
  const audienceLabel = () => {
    if (source === 'contacts') return `Contacts · ${contactLists.find(l => String(l.id) === String(contactListId))?.name || '—'}`
    if (source === 'monday') return `Monday · ${boards.find(b => String(b.id) === String(mondayBoardId))?.name || '—'}`
    if (source === 'sheets') return `Sheet · ${sheetName || '—'}`
    return '—'
  }

  const create = async () => {
    setCreating(true); setError('')
    try {
      const senderPhone = phoneNumbers.find(p => String(p.id) === String(senderId))
      const recipient_filters = engagement && engagement !== 'all'
        ? { engagement, ...(engagement === 'not_replied_recent' ? { window_hours: Number(windowHours) } : {}) }
        : null
      const payload = {
        name: draft.name || 'New campaign',
        message_template: draft.message,
        sender_number: phoneOf(senderPhone),
        source: source || 'contacts',
        contact_list_ids: source === 'contacts' && contactListId ? [contactListId] : [],
        scheduled_at: scheduleType === 'scheduled' && scheduleDate && scheduleClock ? new Date(`${scheduleDate}T${scheduleClock}`).toISOString() : null,
        daily_cap: dailyLimitEnabled ? Number(dailyCap) : null,
        recurring: !!recurring,
        recipient_filters,
        draft: false,
      }
      const res = await post('/api/campaigns', payload)
      const d = await res.json()
      if (!res.ok || !d.campaign?.id) throw new Error([d.error, d.details].filter(Boolean).join(' — ') || 'Could not create the campaign.')
      const id = d.campaign.id
      if (source === 'monday') {
        await post(`/api/campaigns/${id}/monday-link`, { board_id: mondayBoardId, board_name: boards.find(b => String(b.id) === String(mondayBoardId))?.name || '', phone_column_id: mondayPhoneCol, group_ids: [], item_ids: [] }).catch(() => {})
      } else if (source === 'sheets') {
        await post(`/api/campaigns/${id}/sheets-link`, { spreadsheet_id: sheetId, spreadsheet_name: spreadsheets.find(s => String(s.id) === String(sheetId))?.name || '', sheet_id: sheetTabGid, sheet_name: sheetName, phone_column: sheetPhoneCol, row_ids: [] }).catch(() => {})
      }
      if (onCreated) onCreated(d.campaign); else router.push('/campaigns')
    } catch (e) { setError(e.message); setCreating(false) }
  }

  const hasThread = messages.length > 0 || !!draft.message

  const composerProps = { input, setInput, onSend: sendDescribe, busy, models, model, setModel, locked: messages.length > 0 }

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]" style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[#E3E1DB] bg-white shrink-0">
        {headerTabs ? (
          <>{headerTabs}<div className="flex-1" /></>
        ) : (
          <>
            {!inline && (
              <button onClick={() => router.push('/campaigns')} title="Back" className="p-2 -ml-1 rounded-lg text-[#5C5A55] hover:bg-[#F7F6F3]">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              </button>
            )}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-[#D63B1F] flex items-center justify-center shrink-0"><i className="fas fa-wand-magic-sparkles text-white text-xs" /></span>
              <p className="text-base font-semibold text-[#131210] truncate">New campaign</p>
            </div>
          </>
        )}
        <button onClick={onSwitchToManual} className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] shrink-0">
          <i className="fas fa-sliders mr-1.5 text-xs" />Set up manually
        </button>
      </div>

      {error && <div className="px-5 py-2 text-xs bg-[rgba(214,59,31,0.07)] border-b border-[rgba(214,59,31,0.16)] text-[#D63B1F] shrink-0">{error}</div>}

      {!hasThread ? (
        /* Empty state — centered hero */
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 pt-14 md:pt-24 pb-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#D63B1F] flex items-center justify-center mx-auto mb-5 shadow-sm"><i className="fas fa-bullhorn text-white text-xl" /></div>
            <h1 className="text-2xl md:text-3xl font-semibold text-[#131210] tracking-tight">Build your <span className="text-[#D63B1F]">campaign</span> with AI</h1>
            <p className="text-sm text-[#5C5A55] mt-2">Describe what you want to send and to whom — I&rsquo;ll write the text and set it up.</p>
            <p className="text-xs text-[#9B9890] mt-2 mb-8 max-w-lg mx-auto leading-relaxed"><i className="fas fa-circle-info mr-1.5 text-[10px]" />A campaign sends one text to many recipients at once. You launch it from the list when it&rsquo;s ready.</p>
            <div className="text-left"><Composer rows={3} placeholder="e.g. Promote this Saturday's open house at 123 Oak St to my seller leads…" {...composerProps} /></div>
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" onClick={() => setInput(s)} className="px-3.5 py-2 text-xs text-[#5C5A55] bg-white border border-[#E3E1DB] rounded-full hover:border-[#D63B1F]/40 hover:text-[#131210] transition-colors">{s}</button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Chat thread */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
            <div className="max-w-3xl mx-auto space-y-3">
              {messages.map((m, i) => (
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end"><div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap bg-[#D63B1F] text-white">{m.content}</div></div>
                ) : (
                  <div key={i} className="flex justify-start"><div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed bg-white border border-[#E3E1DB] text-[#131210] whitespace-pre-wrap">{m.content}</div></div>
                )
              ))}

              {/* Draft card — collapses to a compact line once accepted */}
              {draft.message && (promptAccepted
                ? <Done label="Message" value={draft.name || 'Campaign'} onChange={() => setPromptAccepted(false)} />
                : (
                  <Card title="Here's your campaign" subtitle="Edit the text if you like, then use it.">
                    <label className={labelCls}>Campaign name</label>
                    <input className={`${inputCls} mb-3`} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                    <label className={labelCls}>Message</label>
                    <textarea rows={4} className={`${inputCls} resize-none`} value={draft.message} onChange={e => setDraft(d => ({ ...d, message: e.target.value }))} />
                    <p className="text-[11px] text-[#9B9890] mt-1">Placeholders like {'{first_name}'} are filled per recipient.</p>
                    <button onClick={() => setPromptAccepted(true)} disabled={!draft.message.trim()} className="mt-3 w-full bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-50">Use this message →</button>
                  </Card>
                ))}

              {busy && <div className="flex justify-start"><div className="bg-white border border-[#E3E1DB] px-4 py-3 rounded-2xl rounded-bl-md"><span className="inline-flex items-center gap-2.5 text-xs text-[#5C5A55]"><TypingDots /> Writing…</span></div></div>}

              {/* Queue */}
              {promptAccepted && (
                <>
                  {stepState('sender') === 'done'
                    ? <Done label="Send from" value={senderLabel()} onChange={() => setStage('sender')} />
                    : stepState('sender') === 'active' && (
                      <Card title="Which number should it send from?">
                        <SearchableDropdown value={senderId} onChange={setSenderId} loading={loadingLookups} placeholder="Select a number…"
                          options={phoneNumbers.map(p => ({ value: String(p.id), label: p.custom_name ? `${p.custom_name} (${phoneOf(p)})` : phoneOf(p), searchText: `${p.custom_name || ''} ${phoneOf(p)}` }))}
                          renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                        <button onClick={() => advance('sender')} disabled={!senderId} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('source') === 'done'
                    ? <Done label="Audience source" value={source} onChange={() => setStage('source')} />
                    : stepState('source') === 'active' && (
                      <Card title="Where do the recipients come from?">
                        <Pills value={source} onPick={setSource} options={[{ v: 'contacts', label: 'A contact list' }, ...(mondayConnected ? [{ v: 'monday', label: 'A Monday board' }] : []), ...(sheetsConnected ? [{ v: 'sheets', label: 'A Google Sheet' }] : [])]} />
                        <button onClick={() => advance('source')} disabled={!source} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('audience') === 'done'
                    ? <Done label="Audience" value={audienceLabel()} onChange={() => setStage('audience')} />
                    : stepState('audience') === 'active' && (
                      <Card title="Pick the audience">
                        {source === 'contacts' && (
                          <SearchableDropdown value={contactListId} onChange={setContactListId} loading={loadingLookups} placeholder="Select a contact list…"
                            options={contactLists.map(l => ({ value: String(l.id), label: `${l.name}${l.contactCount != null ? ` (${l.contactCount})` : ''}`, searchText: l.name }))}
                            renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                        )}
                        {source === 'monday' && (
                          <div className="space-y-2">
                            <SearchableDropdown value={mondayBoardId} onChange={v => { setMondayBoardId(v); setMondayPhoneCol('') }} loading={loadingBoards} placeholder="Select a board…"
                              options={boards.map(b => ({ value: String(b.id), label: b.name, searchText: b.name }))}
                              renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                            {mondayBoardId && (
                              <SearchableDropdown value={mondayPhoneCol} onChange={setMondayPhoneCol} loading={loadingBoardCols} placeholder="Phone-number column…"
                                options={boardColumns.map(c => ({ value: String(c.id), label: `${c.title}${c.type ? ` · ${c.type}` : ''}`, searchText: `${c.title} ${c.type || ''}` }))}
                                renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                            )}
                          </div>
                        )}
                        {source === 'sheets' && (
                          <div className="space-y-2">
                            <SearchableDropdown value={sheetId} onChange={v => { setSheetId(v); setSheetName(''); setSheetTabGid(null); setSheetPhoneCol('') }} loading={loadingSpreadsheets} placeholder="Select a spreadsheet…"
                              options={spreadsheets.map(s => ({ value: String(s.id), label: s.name, searchText: s.name }))}
                              renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                            {sheetId && (
                              <SearchableDropdown value={sheetName} onChange={v => { const t = tabs.find(x => x.title === v); setSheetName(v); setSheetTabGid(t?.id ?? null); setSheetPhoneCol('') }} loading={loadingTabs} placeholder="Select a tab…"
                                options={tabs.map(t => ({ value: t.title, label: t.title, searchText: t.title }))}
                                renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                            )}
                            {sheetName && (
                              <SearchableDropdown value={sheetPhoneCol} onChange={setSheetPhoneCol} loading={loadingSheetCols} placeholder="Phone-number column…"
                                options={sheetColumns.map(c => ({ value: String(c.id), label: c.title || `Column ${c.id}`, searchText: `${c.title || ''} ${c.id}` }))}
                                renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                            )}
                          </div>
                        )}
                        <button onClick={() => advance('audience')} disabled={(source === 'contacts' && !contactListId) || (source === 'monday' && (!mondayBoardId || !mondayPhoneCol)) || (source === 'sheets' && (!sheetId || !sheetName || !sheetPhoneCol))} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {source === 'contacts' && (stepState('engagement') === 'done'
                    ? <Done label="Filter" value={ENGAGEMENT_OPTS.find(o => o.v === engagement)?.label || engagement} onChange={() => setStage('engagement')} />
                    : stepState('engagement') === 'active' && (
                      <Card title="Everyone, or narrow it down?">
                        <Pills value={engagement} onPick={setEngagement} options={ENGAGEMENT_OPTS} />
                        {engagement === 'not_replied_recent' && (
                          <div className="mt-2">
                            <SearchableDropdown value={String(windowHours)} onChange={v => setWindowHours(Number(v))} placeholder="Quiet for…"
                              options={WINDOW_OPTS.map(([v, l]) => ({ value: String(v), label: `Quiet for ${l}`, searchText: l }))}
                              renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                          </div>
                        )}
                        <button onClick={() => advance('engagement')} className={contBtn}>Continue</button>
                      </Card>
                    ))}

                  {stepState('schedule') === 'done'
                    ? <Done label="Schedule" value={scheduleType === 'scheduled' && scheduleDate && scheduleClock ? new Date(`${scheduleDate}T${scheduleClock}`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Send now'} onChange={() => setStage('schedule')} />
                    : stepState('schedule') === 'active' && (
                      <Card title="Send now or schedule it?">
                        <Pills value={scheduleType} onPick={setScheduleType} options={[{ v: 'immediate', label: 'Send now' }, { v: 'scheduled', label: 'Pick a time' }]} />
                        {scheduleType === 'scheduled' && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <DatePicker value={scheduleDate} onChange={setScheduleDate} />
                            <SearchableDropdown value={scheduleClock} onChange={setScheduleClock} placeholder="Pick a time…"
                              options={buildTimeOptions()} renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                          </div>
                        )}
                        <button onClick={() => advance('schedule')} disabled={scheduleType === 'scheduled' && (!scheduleDate || !scheduleClock)} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('pace') === 'done'
                    ? <Done label="Pace" value={`${dailyLimitEnabled ? `${dailyCap}/day` : 'no cap'}${businessHoursOnly ? ' · business hours' : ''}${recurring ? ' · recurring' : ''}`} onChange={() => setStage('pace')} />
                    : stepState('pace') === 'active' && (
                      <Card title="Any sending limits?" subtitle="Sensible defaults are fine — you can change these later.">
                        <label className="flex items-center gap-2 text-sm text-[#5C5A55] mb-2"><input type="checkbox" checked={dailyLimitEnabled} onChange={e => setDailyLimitEnabled(e.target.checked)} /> Limit per day{dailyLimitEnabled && <input type="number" min={1} className="ml-2 w-24 px-2 py-1 border border-[#D4D1C9] rounded" value={dailyCap} onChange={e => setDailyCap(e.target.value)} />}</label>
                        <label className="flex items-center gap-2 text-sm text-[#5C5A55] mb-2"><input type="checkbox" checked={businessHoursOnly} onChange={e => setBusinessHoursOnly(e.target.checked)} /> Business hours only</label>
                        <label className="flex items-center gap-2 text-sm text-[#5C5A55]"><input type="checkbox" checked={recurring} disabled={!dailyLimitEnabled} onChange={e => setRecurring(e.target.checked)} /> Keep cycling (recurring) <span className="text-[11px] text-[#9B9890]">needs a daily limit</span></label>
                        <button onClick={() => advance('pace')} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('create') === 'active' && (
                    <Card title="Ready to create" subtitle="I'll save this as a draft you can launch from the campaigns list.">
                      <button onClick={create} disabled={creating} className="w-full bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-60">{creating ? 'Creating…' : 'Create campaign'}</button>
                    </Card>
                  )}
                </>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Composer — only before a draft exists; once drafted, edit in the card */}
          {!draft.message && (
            <div className="border-t border-[#E3E1DB] bg-white px-4 md:px-8 py-3 shrink-0">
              <div className="max-w-3xl mx-auto">
                <Composer rows={1} placeholder="Describe your campaign…" {...composerProps} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
