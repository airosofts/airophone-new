'use client'

// Assisted scenario builder — a single chat thread where the APP drives a
// deterministic setup queue:
//   1. The user describes the agent; builder-chat writes the prompt →
//      inline PROMPT DOCUMENT CARD (editable name + prompt + refine box).
//   2. "Use this prompt" starts a FIXED queue of setup steps, each appended
//      as an app-authored assistant message with an inline widget (no LLM
//      call between steps). Anything the user already stated arrives
//      pre-validated in builder-chat's `settings` and is skipped with a
//      compact "✓ … (you mentioned it) — Change" line. Free-text answers to
//      an active widget round-trip through builder-chat for extraction.
//   3. When the queue completes, the view auto-switches to a full REVIEW
//      PAGE (not a thread item) → POST /api/scenarios → /scenarios list.
//
// builder-chat contract: POST { messages, current: { name, instructions } }
//   → { success, reply, name, instructions, settings } where `settings` only
//   contains values the user explicitly stated (already validated).

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'

// Reply-framed on purpose: the agent only ANSWERS incoming texts — campaigns
// and automations send the first message.
const SUGGESTIONS = [
  'When home sellers reply to my campaign, answer them and book a call',
  'Answer DSCR loan leads who text back and qualify them for my team',
  'Reply to questions about my detailing shop and collect the car details',
]

const DEFAULT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL']

// The deterministic setup queue — app-authored, never model-driven.
const QUEUE = [
  'phone_number_ids',
  'contact_list_ids',
  'enable_followups',
  'auto_stop_keywords',
  'ai_reply_mode',
  'books_appointments',
  'ai_model',
]

const inp = 'w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]'

// ---------- provider logos ----------

// Real provider logos from /public — square-cropped 128px versions so they
// render crisp and full-bleed at icon size (the original ChatGPT png was a
// wide canvas with big white margins that shrank the mark to a dot).
const VENDOR_LOGOS = {
  ChatGPT: { src: '/chatgpt-logo-sq.png', round: true },   // black knot, white bg → white circle badge
  Claude: { src: '/claude-128.jpeg', round: true },        // white starburst on terracotta → round badge
  Gemini: { src: '/gemini-128.png', round: false },        // transparent gradient star → bare glyph
}

function VendorLogo({ vendor, size = 20 }) {
  const logo = VENDOR_LOGOS[vendor] || VENDOR_LOGOS.ChatGPT
  return (
    <img
      src={logo.src}
      alt={vendor}
      width={size}
      height={size}
      className={`shrink-0 object-cover ${logo.round ? 'rounded-full ring-1 ring-[#E3E1DB]' : ''}`}
      style={{ width: size, height: size }}
    />
  )
}

// ---------- small building blocks ----------

// The assistant is told to reply in plain text, but models still slip in
// **bold** — render it as real bold instead of literal asterisks.
function renderAssistantText(text) {
  const parts = String(text || '').split(/\*\*([^*]+)\*\*/g)
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part))
}

const TypingDots = () => (
  <span className="inline-flex gap-1">
    <span className="w-1.5 h-1.5 rounded-full bg-[#9B9890] animate-bounce" style={{ animationDelay: '0ms' }} />
    <span className="w-1.5 h-1.5 rounded-full bg-[#9B9890] animate-bounce" style={{ animationDelay: '150ms' }} />
    <span className="w-1.5 h-1.5 rounded-full bg-[#9B9890] animate-bounce" style={{ animationDelay: '300ms' }} />
  </span>
)

// ---------- main component ----------

export default function ScenarioAgentChat({ onSwitchToManual }) {
  const router = useRouter()

  // Thread items: { id, type: 'user'|'assistant'|'prompt'|'step',
  //   content?, field?, status?, premapped?, hint? }
  const [thread, setThread] = useState([])
  const [view, setView] = useState('chat')           // 'chat' | 'review'
  const [transcript, setTranscript] = useState([])   // {role, content} history for builder-chat
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState('')

  // Prompt document (single source of truth; the card renders these live)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [statusLine, setStatusLine] = useState('')
  const [promptAccepted, setPromptAccepted] = useState(false)

  // Composer + card refine box
  const [input, setInput] = useState('')
  const [refineInput, setRefineInput] = useState('')

  // Settings values (live state; widgets, compact lines and review read these)
  const [phoneIds, setPhoneIds] = useState([])
  const [audience, setAudience] = useState('all')          // 'all' | 'lists'
  const [listIds, setListIds] = useState([])
  const [listOpen, setListOpen] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [enableFollowups, setEnableFollowups] = useState(false)
  const [attempts, setAttempts] = useState(3)
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS)
  const [keywordInput, setKeywordInput] = useState('')
  const [replyMode, setReplyMode] = useState('anytime')    // 'anytime' | 'business_hours'
  const [booksAppointments, setBooksAppointments] = useState(true)
  const booksTouched = useRef(false)
  const [aiModel, setAiModel] = useState('')               // '' = workspace default

  // Review / create
  const [showReviewPrompt, setShowReviewPrompt] = useState(false)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)

  // Reference data
  const [aiModels, setAiModels] = useState([])
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [contactLists, setContactLists] = useState([])

  const premappedRef = useRef(new Set())   // fields already answered via `settings`
  const idRef = useRef(0)
  const nid = () => ++idRef.current
  const inputRef = useRef(null)
  const bottomRef = useRef(null)
  const prevLenRef = useRef(0)

  useEffect(() => {
    fetchWithWorkspace('/api/ai-models').then(r => r.json()).then(d => setAiModels(d.models || [])).catch(() => {})
    fetchWithWorkspace('/api/phone-numbers').then(r => r.json()).then(d => setPhoneNumbers(d.phoneNumbers || [])).catch(() => {})
    apiGet('/api/contact-lists').then(r => r.json()).then(d => setContactLists(d.contactLists || [])).catch(() => {})
  }, [])

  // Auto-scroll only when the thread grows (not on in-place widget reopens).
  useEffect(() => {
    if (thread.length > prevLenRef.current || drafting) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevLenRef.current = thread.length
  }, [thread, drafting])

  // ----- queue engine (pure over thread items + the premapped set) -----

  // Walk QUEUE in order. Answered fields keep their item (or get a compact
  // pre-mapped confirmation appended). The first unanswered field gets an
  // active widget. When everything is answered, drop a one-time cue line —
  // the review itself is a separate page view, never a thread item.
  const ensureProgress = items => {
    let t = items
    for (const f of QUEUE) {
      const item = t.find(x => x.type === 'step' && x.field === f)
      if (item) {
        if (item.status === 'active') return t   // waiting on the user
        continue                                  // answered
      }
      if (premappedRef.current.has(f)) {
        t = [...t, { id: nid(), type: 'step', field: f, status: 'done', premapped: true }]
        continue
      }
      return [...t, { id: nid(), type: 'step', field: f, status: 'active' }]
    }
    // No cue bubble — the sticky "Review scenario →" bar above the composer
    // is the single entry point (a bubble too was redundant).
    return t
  }

  // Queue complete → automatically show the review page (only on the
  // transition, so "Back to chat" doesn't bounce straight back).
  const queueComplete = promptAccepted &&
    QUEUE.every(f => thread.some(x => x.type === 'step' && x.field === f && x.status === 'done'))
  const wasCompleteRef = useRef(false)
  useEffect(() => {
    if (queueComplete && !wasCompleteRef.current) setView('review')
    wasCompleteRef.current = queueComplete
  }, [queueComplete])

  const completeSteps = fields => {
    setListOpen(false)
    setThread(t => ensureProgress(t.map(x =>
      x.type === 'step' && fields.includes(x.field) ? { ...x, status: 'done', hint: null } : x)))
  }

  // "Change" — in place from a compact line; moved to the end of the thread
  // when coming from the review page (which also switches back to chat).
  const reopenStep = (field, moveToEnd = false) => {
    setError('')
    setView('chat')
    setThread(t => {
      if (!moveToEnd) {
        return t.map(x => (x.type === 'step' && x.field === field ? { ...x, status: 'active', hint: null } : x))
      }
      const rest = t.filter(x => !(x.type === 'step' && x.field === field))
      return [...rest, { id: nid(), type: 'step', field, status: 'active' }]
    })
  }

  // Apply validated settings from builder-chat. Returns the queue fields it
  // filled so the caller can mark their widgets done / skip them.
  const applySettings = settings => {
    if (!settings || typeof settings !== 'object') return []
    const applied = []
    if ('phone_number_ids' in settings) { setPhoneIds(settings.phone_number_ids || []); applied.push('phone_number_ids') }
    if ('contact_list_ids' in settings) {
      const v = settings.contact_list_ids || []
      setAudience(v.length ? 'lists' : 'all')   // [] = everyone
      setListIds(v)
      applied.push('contact_list_ids')
    }
    if ('enable_followups' in settings) { setEnableFollowups(!!settings.enable_followups); applied.push('enable_followups') }
    if ('max_followup_attempts' in settings) setAttempts(Number(settings.max_followup_attempts) || 3)
    if ('auto_stop_keywords' in settings) { setKeywords(settings.auto_stop_keywords || []); applied.push('auto_stop_keywords') }
    if ('ai_reply_mode' in settings) { setReplyMode(settings.ai_reply_mode); applied.push('ai_reply_mode') }
    if ('books_appointments' in settings) { setBooksAppointments(!!settings.books_appointments); booksTouched.current = true; applied.push('books_appointments') }
    if ('ai_model' in settings) { setAiModel(settings.ai_model || ''); applied.push('ai_model') }
    applied.forEach(f => premappedRef.current.add(f))
    return applied
  }

  // ----- builder-chat round-trips (first draft, refines, free-text answers) -----

  const handleUserText = async (text, restore) => {
    const trimmed = (text || '').trim()
    if (!trimmed || drafting) return
    setError('')
    const baseTranscript = transcript
    const apiMessages = [...baseTranscript, { role: 'user', content: trimmed }]
    const bubbleId = nid()
    setTranscript(apiMessages)
    setThread(t => [...t, { id: bubbleId, type: 'user', content: trimmed }])
    setDrafting(true)
    try {
      const res = await apiPost('/api/scenarios/builder-chat', {
        messages: apiMessages,
        current: { name, instructions },   // includes any hand edits
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) throw new Error(data.error || 'The assistant could not reply. Please try again.')
      setTranscript([...apiMessages, { role: 'assistant', content: data.reply || '' }])
      if (data.name) setName(data.name)
      if (data.instructions) setInstructions(data.instructions)
      setStatusLine(data.reply || '')
      const applied = applySettings(data.settings)

      setThread(t => {
        // Prompt phase: the document card absorbs the response in place.
        if (!promptAccepted) {
          if (!t.some(x => x.type === 'prompt')) {
            return [...t,
              { id: nid(), type: 'assistant', content: data.reply || '' },
              { id: nid(), type: 'prompt', status: 'open' },
            ]
          }
          return t
        }
        // Queue / review phase.
        const hadActive = t.some(x => x.type === 'step' && x.status === 'active')
        if (applied.length) {
          let next = t.map(x => (x.type === 'step' && applied.includes(x.field) ? { ...x, status: 'done', hint: null } : x))
          if (!hadActive) next = [...next, { id: nid(), type: 'assistant', content: data.reply || '' }]
          return ensureProgress(next)
        }
        if (hadActive) {
          // Nothing matched → gentle hint under the active widget.
          return t.map(x => (x.type === 'step' && x.status === 'active'
            ? { ...x, hint: 'Use the buttons below, or try rephrasing.' } : x))
        }
        // Queue already complete (prompt tweaks / questions) → show the reply.
        return ensureProgress([...t, { id: nid(), type: 'assistant', content: data.reply || '' }])
      })
    } catch (e) {
      setError(e.message || 'Something went wrong. Please try again.')
      setTranscript(baseTranscript)
      setThread(t => t.filter(x => x.id !== bubbleId))
      restore?.(trimmed)
    } finally {
      setDrafting(false)
    }
  }

  const send = () => {
    const text = input.trim()
    if (!text || drafting) return
    setInput('')
    handleUserText(text, setInput)
  }

  const sendRefine = () => {
    const text = refineInput.trim()
    if (!text || drafting) return
    setRefineInput('')
    handleUserText(text, setRefineInput)
  }

  // ----- prompt card accept / reopen -----

  const acceptPrompt = () => {
    if (drafting || !instructions.trim()) return
    // Suggest the booking toggle from the prompt, until the user weighs in.
    if (!booksTouched.current && !premappedRef.current.has('books_appointments')) {
      setBooksAppointments(/book|appointment|schedule/i.test(instructions))
    }
    setPromptAccepted(true)
    setError('')
    setThread(t => ensureProgress(t.map(x => (x.type === 'prompt' ? { ...x, status: 'accepted' } : x))))
  }

  // Reopen the prompt document at the end of the thread ("Edit" / "Refine").
  // Always returns to the chat view — the card lives in the thread.
  const openPromptCard = () => {
    setPromptAccepted(false)
    setError('')
    setView('chat')
    setThread(t => [
      ...t.filter(x => x.type !== 'prompt'),
      { id: nid(), type: 'prompt', status: 'open' },
    ])
  }

  // ----- create -----

  const canCreate = !!(name.trim() && instructions.trim() && phoneIds.length)

  const create = async () => {
    if (!canCreate || creating || created) return
    setError('')
    setCreating(true)
    try {
      const res = await apiPost('/api/scenarios', {
        name: name.trim(),
        instructions,
        phoneNumbers: phoneIds,
        contact_list_ids: audience === 'lists' ? listIds : [],   // empty = everyone
        contacts: [],
        enable_followups: enableFollowups,
        max_followup_attempts: attempts,
        auto_stop_keywords: keywords.length ? keywords : DEFAULT_KEYWORDS,
        ai_reply_mode: replyMode,
        books_appointments: booksAppointments,
        ai_model: aiModel || null,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create scenario')
      setCreated(true)
      setTimeout(() => router.push('/scenarios'), 900)
    } catch (e) {
      setError(e.message || 'Failed to create scenario')
      setCreating(false)
    }
  }

  // ----- resolvers -----

  const phoneLabel = id => {
    const p = phoneNumbers.find(x => x.id === id)
    return p ? (p.custom_name || p.phoneNumber || p.phone_number) : id
  }
  const phoneSubLabel = p => (p.custom_name ? (p.phoneNumber || p.phone_number) : null)
  const listLabel = id => contactLists.find(l => l.id === id)?.name || id
  const selectedModel = aiModel
    ? aiModels.find(m => m.id === aiModel)
    : aiModels.find(m => m.isDefault)

  const addKeyword = () => {
    const k = keywordInput.trim().toUpperCase()
    if (k && !keywords.includes(k)) setKeywords(p => [...p, k])
    setKeywordInput('')
  }

  const filteredLists = contactLists.filter(l =>
    !listSearch.trim() || (l.name || '').toLowerCase().includes(listSearch.trim().toLowerCase()))

  const stepSummary = field => {
    switch (field) {
      case 'phone_number_ids':
        return { label: 'Line', value: phoneIds.length ? phoneIds.map(phoneLabel).join(', ') : '—' }
      case 'contact_list_ids':
        return { label: 'Audience', value: audience === 'all' ? 'Everyone who texts this line' : (listIds.map(listLabel).join(', ') || '—') }
      case 'enable_followups':
        return { label: 'Follow-ups', value: enableFollowups ? `On · ${attempts} attempts` : 'Off' }
      case 'auto_stop_keywords':
        return { label: 'Stop keywords', value: keywords.length ? keywords.join(', ') : 'None' }
      case 'ai_reply_mode':
        return { label: 'Reply hours', value: replyMode === 'business_hours' ? 'Only during business hours' : 'Respond anytime' }
      case 'books_appointments':
        return { label: 'Appointment booking', value: booksAppointments ? 'Yes' : 'No' }
      case 'ai_model':
        return { label: 'AI model', value: selectedModel ? `${selectedModel.label}${!aiModel ? ' (default)' : ''}` : '—' }
      default:
        return { label: field, value: '—' }
    }
  }

  // ----- widget bodies (app-authored, deterministic) -----

  const pill = active => `px-4 py-2 rounded-full text-sm border transition-colors ${
    active
      ? 'bg-[rgba(214,59,31,0.08)] border-[#D63B1F] text-[#D63B1F] font-medium'
      : 'bg-white border-[#E3E1DB] text-[#5C5A55] hover:border-[#D63B1F]/40 hover:text-[#131210]'
  }`

  const continueBtn = (onClick, disabled = false, label = 'Continue') => (
    <button type="button" onClick={onClick} disabled={disabled || drafting}
      className="px-4 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-40">
      {label}
    </button>
  )

  const widgetBody = field => {
    switch (field) {
      case 'phone_number_ids':
        return {
          title: 'Which line should it answer on?',
          hint: 'Texts are sent and received on this number. Pick more than one to share the agent across lines.',
          body: (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {phoneNumbers.length === 0
                ? <p className="text-xs text-[#9B9890] py-1">No phone numbers available in this workspace yet.</p>
                : phoneNumbers.map(pn => (
                  <label key={pn.id}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer ${
                      phoneIds.includes(pn.id) ? 'border-[#D63B1F] bg-[rgba(214,59,31,0.04)]' : 'border-[#E3E1DB] hover:bg-[#FBFAF8]'
                    }`}>
                    <input type="checkbox" checked={phoneIds.includes(pn.id)}
                      onChange={e => setPhoneIds(p => e.target.checked ? [...p, pn.id] : p.filter(id => id !== pn.id))}
                      className="accent-[#D63B1F]" />
                    <span className="min-w-0">
                      <span className="block text-sm text-[#131210] truncate">{phoneLabel(pn.id)}</span>
                      {phoneSubLabel(pn) && <span className="block text-[11px] text-[#9B9890]">{phoneSubLabel(pn)}</span>}
                    </span>
                  </label>
                ))}
            </div>
          ),
          footer: continueBtn(() => completeSteps(['phone_number_ids']), !phoneIds.length),
        }

      case 'contact_list_ids':
        return {
          title: 'Who can it reply to?',
          hint: 'Limit the agent to certain contact lists, or let it answer anyone.',
          body: (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { v: 'all', t: 'Everyone who texts this line', d: 'The agent answers any inbound text.' },
                  { v: 'lists', t: 'Only specific contact lists', d: 'Others are left for you to answer.' },
                ].map(o => (
                  <button key={o.v} type="button" onClick={() => setAudience(o.v)}
                    className={`text-left px-3 py-2.5 rounded-lg border ${
                      audience === o.v ? 'border-[#D63B1F] bg-[rgba(214,59,31,0.04)]' : 'border-[#E3E1DB] hover:bg-[#FBFAF8]'
                    }`}>
                    <span className="flex items-center gap-2">
                      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                        audience === o.v ? 'border-[#D63B1F]' : 'border-[#D4D1C9]'
                      }`}>
                        {audience === o.v && <span className="w-2 h-2 rounded-full bg-[#D63B1F]" />}
                      </span>
                      <span className="text-sm text-[#131210]">{o.t}</span>
                    </span>
                    <span className="block text-[11px] text-[#9B9890] mt-1 ml-[22px]">{o.d}</span>
                  </button>
                ))}
              </div>
              {audience === 'lists' && (
                <div className="mt-2.5 relative">
                  <button type="button" onClick={() => setListOpen(v => !v)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-[#D4D1C9] rounded-md text-sm bg-white hover:bg-[#FBFAF8]">
                    <span className={listIds.length ? 'text-[#131210]' : 'text-[#9B9890]'}>
                      {listIds.length ? `${listIds.length} list${listIds.length > 1 ? 's' : ''} selected` : 'Select contact lists…'}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {listIds.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(214,59,31,0.1)] text-[#D63B1F] font-semibold">{listIds.length}</span>
                      )}
                      <i className="fas fa-chevron-down text-[10px] text-[#9B9890]" />
                    </span>
                  </button>
                  {listOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setListOpen(false)} />
                      <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-white border border-[#E3E1DB] rounded-xl shadow-xl overflow-hidden">
                        <div className="p-2 border-b border-[#F1EFEA]">
                          <input value={listSearch} onChange={e => setListSearch(e.target.value)}
                            placeholder="Search lists…" autoFocus
                            className="w-full px-3 py-1.5 border border-[#E3E1DB] rounded-md text-sm focus:outline-none focus:border-[#D63B1F]" />
                        </div>
                        <div className="max-h-52 overflow-y-auto py-1">
                          {filteredLists.length === 0 && (
                            <p className="px-3 py-2.5 text-xs text-[#9B9890]">{contactLists.length === 0 ? 'No contact lists yet.' : 'No lists match your search.'}</p>
                          )}
                          {filteredLists.map(l => (
                            <label key={l.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3]">
                              <input type="checkbox" checked={listIds.includes(l.id)}
                                onChange={e => setListIds(p => e.target.checked ? [...p, l.id] : p.filter(id => id !== l.id))}
                                className="accent-[#D63B1F]" />
                              <span className="text-sm text-[#131210] truncate">{l.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          ),
          footer: continueBtn(() => completeSteps(['contact_list_ids']), audience === 'lists' && !listIds.length),
        }

      case 'enable_followups':
        return {
          title: 'Should it follow up automatically if a lead goes quiet?',
          hint: 'Nudges the lead again after no response.',
          body: (
            <>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEnableFollowups(true)} className={pill(enableFollowups)}>Yes</button>
                <button type="button" onClick={() => { setEnableFollowups(false); completeSteps(['enable_followups']) }} className={pill(false)}>No</button>
              </div>
              {enableFollowups && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-[#5C5A55] mb-1.5">Max attempts</label>
                  <select value={attempts} onChange={e => setAttempts(parseInt(e.target.value))} className={`${inp} max-w-[10rem]`}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              )}
            </>
          ),
          footer: enableFollowups ? continueBtn(() => completeSteps(['enable_followups'])) : null,
        }

      case 'auto_stop_keywords':
        return {
          title: 'Stop keywords',
          hint: 'If a lead texts one of these, the AI stops messaging them.',
          body: (
            <>
              <div className="flex flex-wrap gap-1.5">
                {keywords.map(k => (
                  <span key={k} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-[#EFEDE8] text-xs text-[#5C5A55]">
                    {k}
                    <button type="button" onClick={() => setKeywords(p => p.filter(x => x !== k))} title={`Remove ${k}`}
                      className="w-4 h-4 rounded-full hover:bg-[#E3E1DB] flex items-center justify-center">
                      <i className="fas fa-xmark text-[9px]" />
                    </button>
                  </span>
                ))}
                {keywords.length === 0 && <span className="text-xs text-[#9B9890]">No keywords — the AI never auto-stops.</span>}
              </div>
              <div className="flex gap-2 mt-2.5">
                <input value={keywordInput} onChange={e => setKeywordInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
                  placeholder="Add keyword" className={`${inp} max-w-[11rem] uppercase placeholder:normal-case`} />
                <button type="button" onClick={addKeyword} disabled={!keywordInput.trim()}
                  className="px-3.5 py-2 text-xs font-medium text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] disabled:opacity-40">
                  Add
                </button>
              </div>
            </>
          ),
          footer: continueBtn(() => completeSteps(['auto_stop_keywords']), false, 'Confirm'),
        }

      case 'ai_reply_mode':
        return {
          title: 'When should it reply?',
          hint: null,
          body: (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { v: 'anytime', t: 'Respond anytime', d: 'Replies 24/7, books within business hours.' },
                { v: 'business_hours', t: 'Only during business hours', d: 'Defers replies to the next opening.' },
              ].map(o => (
                <button key={o.v} type="button"
                  onClick={() => setReplyMode(o.v)}
                  className={`text-left px-3 py-2.5 rounded-lg border ${
                    replyMode === o.v ? 'border-[#D63B1F] bg-[rgba(214,59,31,0.04)]' : 'border-[#E3E1DB] hover:bg-[#FBFAF8]'
                  }`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                      replyMode === o.v ? 'border-[#D63B1F]' : 'border-[#D4D1C9]'
                    }`}>
                      {replyMode === o.v && <span className="w-2 h-2 rounded-full bg-[#D63B1F]" />}
                    </span>
                    <span className="text-sm text-[#131210]">{o.t}</span>
                  </span>
                  <span className="block text-[11px] text-[#9B9890] mt-1 ml-[22px]">{o.d}</span>
                </button>
              ))}
            </div>
          ),
          footer: continueBtn(() => completeSteps(['ai_reply_mode'])),
        }

      case 'books_appointments':
        return {
          title: 'Should it book appointments?',
          hint: `Suggested: ${booksAppointments ? 'Yes' : 'No'} — based on your prompt. Confirmed times stay inside business hours.`,
          body: (
            <div className="flex gap-2">
              <button type="button"
                onClick={() => { booksTouched.current = true; setBooksAppointments(true) }}
                className={pill(booksAppointments)}>Yes</button>
              <button type="button"
                onClick={() => { booksTouched.current = true; setBooksAppointments(false) }}
                className={pill(!booksAppointments)}>No</button>
            </div>
          ),
          footer: continueBtn(() => completeSteps(['books_appointments'])),
        }

      case 'ai_model':
        return {
          title: 'Which AI should write the replies?',
          hint: 'The default works well — switch if you have a preference.',
          body: (
            <div className="space-y-0.5 max-h-64 overflow-y-auto -mx-1 px-1">
              {aiModels.length === 0 && <p className="text-xs text-[#9B9890] py-1">Loading models…</p>}
              {aiModels.map(m => (
                <button key={m.id} type="button" disabled={!m.available}
                  onClick={() => setAiModel(m.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl border ${
                    m.available
                      ? (selectedModel?.id === m.id ? 'border-[#D63B1F] bg-[rgba(214,59,31,0.04)]' : 'border-transparent hover:bg-[#F7F6F3]')
                      : 'border-transparent cursor-not-allowed'
                  }`}>
                  <VendorLogo vendor={m.vendor} size={22} />
                  <span className={`flex-1 min-w-0 truncate text-[14px] ${m.available ? 'text-[#131210]' : 'text-[#B5B2AA]'}`}>
                    {m.vendor === 'ChatGPT' ? m.label : `${m.vendor} ${m.label.replace(new RegExp(`^${m.vendor}\\s*`), '')}`}
                  </span>
                  {m.isDefault && m.available && (
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-[#EFEDE8] text-[#5C5A55]">Default</span>
                  )}
                  {!m.available && (
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-[#EFEDE8] text-[#9B9890]">Needs API key</span>
                  )}
                  {selectedModel?.id === m.id && <i className="fas fa-check text-[12px] text-[#D63B1F] shrink-0" />}
                </button>
              ))}
            </div>
          ),
          footer: continueBtn(() => completeSteps(['ai_model'])),
        }

      default:
        return { title: field, hint: null, body: null, footer: continueBtn(() => completeSteps([field])) }
    }
  }

  // ----- thread item renderers -----

  const renderStep = item => {
    if (item.status === 'active') {
      const w = widgetBody(item.field)
      return (
        <div key={item.id} className="flex justify-start">
          <div className="w-full sm:max-w-[560px] bg-white border border-[#E3E1DB] rounded-xl shadow-sm p-4">
            <p className="text-sm font-semibold text-[#131210]">{w.title}</p>
            {w.hint && <p className="text-[11px] text-[#9B9890] mt-0.5 leading-relaxed">{w.hint}</p>}
            <div className="mt-3">{w.body}</div>
            {item.hint && (
              <p className="text-[11px] text-[#D63B1F] mt-2.5">
                <i className="fas fa-circle-info mr-1" />{item.hint}
              </p>
            )}
            {w.footer && <div className="mt-3.5 flex justify-end">{w.footer}</div>}
          </div>
        </div>
      )
    }
    // Compact confirmation line (pre-mapped skip or completed widget).
    const s = stepSummary(item.field)
    return (
      <div key={item.id} className="flex justify-start">
        <div className="inline-flex items-center gap-2 max-w-full text-xs text-[#5C5A55] bg-white border border-[#E3E1DB] rounded-full px-3 py-1.5">
          <i className="fas fa-check text-[#1F8C4A] text-[10px] shrink-0" />
          <span className="truncate">
            <span className="font-medium text-[#131210]">{s.label}:</span> {s.value}
            {item.premapped && <span className="text-[#9B9890]"> (you mentioned it)</span>}
          </span>
          <button type="button" onClick={() => reopenStep(item.field)}
            className="text-[#D63B1F] font-medium hover:underline shrink-0">
            Change
          </button>
        </div>
      </div>
    )
  }

  const renderPrompt = item => {
    if (item.status !== 'open') {
      return (
        <div key={item.id} className="flex justify-start">
          <div className="inline-flex items-center gap-2 max-w-full text-xs text-[#5C5A55] bg-white border border-[#E3E1DB] rounded-full px-3 py-1.5">
            <i className="fas fa-check text-[#1F8C4A] text-[10px] shrink-0" />
            <span className="truncate"><span className="font-medium text-[#131210]">AI prompt:</span> {name || 'Drafted'}</span>
            <button type="button" onClick={openPromptCard} className="text-[#D63B1F] font-medium hover:underline shrink-0">Edit</button>
          </div>
        </div>
      )
    }
    return (
      <div key={item.id} className="flex justify-start">
        <div className="w-full bg-white border border-[#E3E1DB] rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-3 border-b border-[#F1EFEA]">
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#9B9890] mb-1">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Scenario name"
              className="w-full text-base font-semibold text-[#131210] placeholder-[#9B9890] bg-transparent focus:outline-none"
            />
          </div>
          <div className="px-4 py-3">
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#9B9890] mb-1.5">AI prompt</label>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              rows={12}
              className="w-full min-h-56 px-3 py-2.5 text-[13px] font-mono leading-relaxed text-[#131210] bg-[#FBFAF8] border border-[#E3E1DB] rounded-lg resize-y focus:outline-none focus:border-[#D63B1F] focus:ring-1 focus:ring-[#D63B1F]"
            />
            <p className="text-[10px] text-[#9B9890] mt-1.5">You can edit this directly, or ask me for changes.</p>
          </div>
          <div className="px-4 pb-4">
            {statusLine && !drafting && (
              <p className="flex items-start gap-1.5 text-xs text-[#5C5A55] mb-2">
                <i className="fas fa-wand-magic-sparkles text-[#D63B1F] text-[10px] mt-0.5 shrink-0" />
                <span className="leading-relaxed">{renderAssistantText(statusLine)}</span>
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={refineInput}
                onChange={e => setRefineInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendRefine() } }}
                placeholder="Tell me what to change — e.g. 'make it more casual'"
                disabled={drafting}
                className={`${inp} rounded-lg flex-1`}
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={sendRefine} disabled={drafting || !refineInput.trim()}
                  className="px-4 py-2 text-sm font-medium text-[#D63B1F] border border-[#D63B1F]/40 rounded-lg hover:bg-[rgba(214,59,31,0.06)] disabled:opacity-40 shrink-0">
                  Refine
                </button>
                <button type="button" onClick={acceptPrompt} disabled={drafting || !instructions.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-40 shrink-0">
                  Use this prompt
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ----- review page (full view, replaces the chat area; composer hidden) -----

  const reviewPage = (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="mb-4">
          <button type="button" onClick={() => setView('chat')}
            className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-white">
            <i className="fas fa-arrow-left mr-1.5 text-xs" />Back to chat
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <i className="fas fa-clipboard-check text-[#D63B1F]" />
          <h1 className="text-lg font-semibold text-[#131210]">Review your scenario</h1>
        </div>

        <div className="bg-white border border-[#E3E1DB] rounded-xl shadow-sm overflow-hidden">
          <div className="divide-y divide-[#F1EFEA]">
          {/* Name — inline editable */}
          <div className="px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9B9890]">Name</p>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Scenario name"
              className="w-full mt-0.5 text-sm font-semibold text-[#131210] placeholder-[#9B9890] bg-transparent border-b border-transparent focus:border-[#D63B1F] focus:outline-none pb-0.5" />
          </div>

          {/* Prompt — collapsible, Refine reopens the document card */}
          <div className="px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <button type="button" onClick={() => setShowReviewPrompt(v => !v)}
                className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#9B9890] hover:text-[#5C5A55]">
                AI prompt <i className={`fas fa-chevron-${showReviewPrompt ? 'up' : 'down'} text-[9px]`} />
              </button>
              <button type="button" onClick={openPromptCard} className="text-[11px] font-medium text-[#D63B1F] hover:underline shrink-0">
                Refine
              </button>
            </div>
            {showReviewPrompt
              ? <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap text-[#131210] bg-[#FBFAF8] border border-[#E3E1DB] rounded-lg p-2.5 max-h-56 overflow-y-auto">{instructions}</pre>
              : <p className="mt-1 text-[13px] text-[#5C5A55] truncate">{instructions.split('\n')[0] || '—'}</p>}
          </div>

          {QUEUE.map(f => {
            const s = stepSummary(f)
            return (
              <div key={f} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9B9890]">{s.label}</p>
                  <div className="text-[13px] text-[#131210] mt-0.5 leading-snug break-words">
                    {f === 'ai_model' && selectedModel
                      ? <span className="inline-flex items-center gap-1.5"><VendorLogo vendor={selectedModel.vendor} size={16} />{s.value}</span>
                      : s.value}
                  </div>
                </div>
                <button type="button" onClick={() => reopenStep(f, true)}
                  className="text-[11px] font-medium text-[#D63B1F] hover:underline shrink-0 mt-0.5">
                  Change
                </button>
              </div>
            )
          })}
        </div>

        <div className="px-4 py-4 border-t border-[#E3E1DB] bg-[#FBFAF8]">
          <button type="button" onClick={create} disabled={!canCreate || creating || created}
            className="w-full px-5 py-3 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-40">
            {created ? 'Created!' : creating ? 'Creating…' : 'Create scenario'}
          </button>
          {created && (
            <p className="text-xs text-[#1F8C4A] mt-2 text-center">
              <i className="fas fa-check-circle mr-1" />Created! Taking you to your scenarios…
            </p>
          )}
          {!canCreate && !created && (
            <p className="text-[10px] text-[#9B9890] mt-2 text-center leading-relaxed">
              Needs a name, an AI prompt, and at least one phone line.
            </p>
          )}
          </div>
        </div>
      </div>
    </div>
  )

  // ----- render -----

  const hasThread = thread.length > 0

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E3E1DB] bg-white shrink-0">
        <button onClick={() => router.push('/scenarios')} title="Back" className="p-2 -ml-1 rounded-lg text-[#5C5A55] hover:bg-[#F7F6F3]">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[#D63B1F] flex items-center justify-center shrink-0"><i className="fas fa-wand-magic-sparkles text-white text-xs" /></span>
          <p className="text-base font-semibold text-[#131210] truncate">New scenario</p>
        </div>
        <button onClick={onSwitchToManual}
          className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3]">
          <i className="fas fa-sliders mr-1.5 text-xs" />Set up manually
        </button>
      </div>

      {error && (
        <div className="px-5 py-2 text-xs bg-[rgba(214,59,31,0.07)] border-b border-[rgba(214,59,31,0.16)] text-[#D63B1F] shrink-0">{error}</div>
      )}

      {hasThread && view === 'review' ? (
        /* ---------- Review page (composer hidden) ---------- */
        reviewPage
      ) : !hasThread ? (
        /* ---------- Empty state: centered hero ---------- */
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 pt-14 md:pt-24 pb-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#D63B1F] flex items-center justify-center mx-auto mb-5 shadow-sm">
              <i className="fas fa-wand-magic-sparkles text-white text-xl" />
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-[#131210] tracking-tight">
              Build your <span className="text-[#D63B1F]">AI</span> texting agent
            </h1>
            <p className="text-sm text-[#5C5A55] mt-2">Describe what you want it to do — I&rsquo;ll set everything up for you.</p>
            <p className="text-xs text-[#9B9890] mt-2 mb-8 max-w-lg mx-auto leading-relaxed">
              <i className="fas fa-circle-info mr-1.5 text-[10px]" />
              Your AI replies to incoming texts — campaigns and automations send the first message; this agent handles what comes after.
            </p>

            <div className="text-left bg-white border border-[#E3E1DB] rounded-2xl shadow-sm focus-within:border-[#D63B1F] focus-within:ring-2 focus-within:ring-[#D63B1F]/10">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                rows={3}
                placeholder="e.g. When my roofing leads text back, answer their questions and book an estimate…"
                className="w-full px-4 pt-3.5 pb-1 text-sm text-[#131210] placeholder-[#9B9890] bg-transparent rounded-2xl resize-none focus:outline-none"
              />
              <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1">
                <p className="hidden sm:block text-[10px] text-[#9B9890] pl-1">Enter to send · Shift+Enter for a new line</p>
                <button type="button" onClick={send} disabled={drafting || !input.trim()} title="Send"
                  className="ml-auto w-8 h-8 rounded-full bg-[#D63B1F] hover:bg-[#c23119] text-white flex items-center justify-center disabled:opacity-40 shrink-0">
                  <i className="fas fa-arrow-up text-xs" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" onClick={() => { setInput(s); inputRef.current?.focus() }}
                  className="px-3.5 py-2 text-xs text-[#5C5A55] bg-white border border-[#E3E1DB] rounded-full hover:border-[#D63B1F]/40 hover:text-[#131210] transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ---------- Chat thread ---------- */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
            <div className="max-w-3xl mx-auto space-y-3">
              {thread.map(item => {
                switch (item.type) {
                  case 'user':
                    return (
                      <div key={item.id} className="flex justify-end">
                        <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap bg-[#D63B1F] text-white">
                          {item.content}
                        </div>
                      </div>
                    )
                  case 'assistant':
                    return (
                      <div key={item.id} className="flex justify-start">
                        <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed bg-white border border-[#E3E1DB] text-[#131210]">
                          <span className="whitespace-pre-wrap">{renderAssistantText(item.content)}</span>
                        </div>
                      </div>
                    )
                  case 'prompt':
                    return renderPrompt(item)
                  case 'step':
                    return renderStep(item)
                  default:
                    return null
                }
              })}
              {drafting && (
                <div className="flex justify-start">
                  <div className="bg-white border border-[#E3E1DB] px-4 py-3 rounded-2xl rounded-bl-md">
                    <span className="inline-flex items-center gap-2.5 text-xs text-[#5C5A55]">
                      <TypingDots />
                      {promptAccepted ? 'Checking…' : 'Writing your prompt…'}
                    </span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Sticky path back to review once the queue is complete */}
          {queueComplete && (
            <div className="border-t border-[#E3E1DB] bg-white px-4 md:px-8 py-2 shrink-0">
              <div className="max-w-3xl mx-auto flex items-center justify-end gap-3">
                <p className="hidden sm:block text-[11px] text-[#9B9890]">Everything is answered.</p>
                <button type="button" onClick={() => setView('review')}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg">
                  Review scenario <i className="fas fa-arrow-right ml-1 text-xs" />
                </button>
              </div>
            </div>
          )}

          {/* Composer — persists for refines and free-text answers */}
          <div className="border-t border-[#E3E1DB] bg-white px-4 md:px-8 py-3 shrink-0">
            <div className="max-w-3xl mx-auto">
              <div className="bg-white border border-[#E3E1DB] rounded-2xl focus-within:border-[#D63B1F] focus-within:ring-2 focus-within:ring-[#D63B1F]/10">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  rows={1}
                  placeholder={promptAccepted
                    ? 'Type an answer, or use the buttons above…'
                    : 'Tell me what to change about the prompt…'}
                  className="w-full px-4 pt-3 pb-1 text-sm text-[#131210] placeholder-[#9B9890] bg-transparent rounded-2xl resize-none focus:outline-none"
                />
                <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-0.5">
                  <p className="hidden sm:block text-[10px] text-[#9B9890] pl-1">Enter to send · Shift+Enter for a new line</p>
                  <button type="button" onClick={send} disabled={drafting || !input.trim()} title="Send"
                    className="ml-auto w-8 h-8 rounded-full bg-[#D63B1F] hover:bg-[#c23119] text-white flex items-center justify-center disabled:opacity-40 shrink-0">
                    <i className="fas fa-arrow-up text-xs" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
