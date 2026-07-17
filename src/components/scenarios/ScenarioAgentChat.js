'use client'

// Scenario STUDIO — builder + test on one screen, with persistent chats:
//   LEFT: builder CHATS (ChatGPT-style history, collapsible rail).
//   MAIN, builder mode: model dropdown in the composer → describe → prompt
//     document card ("Use this prompt") → deterministic setup queue, one
//     inline widget at a time (fields already stated arrive pre-validated in
//     builder-chat `settings` and are skipped with "✓ … (you mentioned it)"
//     lines) → last step completes → the scenario is created immediately →
//     the same screen flips into TEST MODE.
//   MAIN, test mode: condensed sandbox chat (same /sandbox APIs).
//
// Persistence: chats live server-side (/api/scenarios/builder-chats). The
// first user send creates the chat; every builder-chat call carries chat_id
// (the server persists the turns), and a debounced PATCH snapshots the draft
// { name, instructions, promptAccepted, answered, premapped, aiModel,
//   scenarioId } after every meaningful change. Reopening a chat rebuilds the
// thread from messages + draft; chats that already produced a scenario open
// straight into TEST MODE (with a "View chat" toggle), and re-accepting a
// refined prompt PATCHes the existing scenario instead of creating a new one.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'
import ScenarioForm from '@/components/scenarios/ScenarioForm'

// Reply-framed on purpose: the agent only ANSWERS incoming texts — campaigns
// and automations send the first message.
const SUGGESTIONS = [
  'When home sellers reply to my campaign, answer them and book a call',
  'Answer DSCR loan leads who text back and qualify them for my team',
  'Reply to questions about my detailing shop and collect the car details',
]

const DEFAULT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL']

// The deterministic setup queue — app-authored, never model-driven.
// (The AI model is NOT a step: it lives in the composer dropdown.)
const QUEUE = [
  'phone_number_ids',
  'contact_list_ids',
  'enable_followups',
  'auto_stop_keywords',
  'ai_reply_mode',
  'books_appointments',
]

const inp = 'w-full px-3 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]'

// ---------- provider logos ----------

// Real provider logos from /public — square-cropped 128px versions so they
// render crisp and full-bleed at icon size.
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

const fmtTime = iso => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

const relTime = iso => {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso))
}

// ---------- main component ----------

export default function ScenarioAgentChat({ onSwitchToManual }) {
  const router = useRouter()

  // ----- studio-level state -----
  const [mode, setMode] = useState('builder')        // 'builder' | 'test' | 'form'
  const [chats, setChats] = useState(null)           // builder chats; null = loading
  const [scenarios, setScenarios] = useState(null)   // workspace scenarios; null = loading
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [menuOpenId, setMenuOpenId] = useState(null)         // per-row "…" menu (row key)
  const [confirmDelete, setConfirmDelete] = useState(null)   // { kind: 'scenario'|'chat', id, linkedChatId? }
  const [formScenario, setFormScenario] = useState(null)   // { id, name, chatId } — embedded edit form
  const [chatId, setChatId] = useState(null)         // current builder chat
  const [chatScenarioId, setChatScenarioId] = useState(null)   // scenario this chat produced
  const [testScenario, setTestScenario] = useState(null)       // { id, name }
  const [createdNote, setCreatedNote] = useState(false)
  const [error, setError] = useState('')

  // ----- reference data -----
  const [aiModels, setAiModels] = useState([])
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [contactLists, setContactLists] = useState([])

  // ----- builder state -----
  // Thread items: { id, type: 'user'|'assistant'|'prompt'|'step', content?, field?, status?, premapped?, hint? }
  const [thread, setThread] = useState([])
  const [transcript, setTranscript] = useState([])   // {role, content} for builder-chat
  const [drafting, setDrafting] = useState(false)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [statusLine, setStatusLine] = useState('')
  const [promptAccepted, setPromptAccepted] = useState(false)
  const [input, setInput] = useState('')
  const [refineInput, setRefineInput] = useState('')
  const [aiModel, setAiModel] = useState('')          // '' = workspace default
  const [modelOpen, setModelOpen] = useState(false)
  // Queue values:
  const [phoneIds, setPhoneIds] = useState([])
  const [audience, setAudience] = useState('all')     // 'all' | 'lists'
  const [listIds, setListIds] = useState([])
  const [listOpen, setListOpen] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [enableFollowups, setEnableFollowups] = useState(false)
  const [attempts, setAttempts] = useState(3)
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS)
  const [keywordInput, setKeywordInput] = useState('')
  const [replyMode, setReplyMode] = useState('anytime')
  const [booksAppointments, setBooksAppointments] = useState(true)
  const booksTouched = useRef(false)
  const [creatingScenario, setCreatingScenario] = useState(false)
  const [createFailed, setCreateFailed] = useState(false)
  const [updatedNote, setUpdatedNote] = useState(false)

  const premappedRef = useRef(new Set())
  const builderInflightRef = useRef(false)   // hard double-send guards
  const createInflightRef = useRef(false)
  const updateInflightRef = useRef(false)
  const createdRef = useRef(false)
  const skipSaveRef = useRef(false)          // suppress snapshot save during restore
  const idRef = useRef(0)
  const nid = () => ++idRef.current
  const inputRef = useRef(null)
  const bottomRef = useRef(null)
  const prevLenRef = useRef(0)

  // ----- test-mode state (absorbed from the sandbox page) -----
  const [sessions, setSessions] = useState(null)
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [testMessages, setTestMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [testInput, setTestInput] = useState('')
  const [testSending, setTestSending] = useState(false)
  const [scenarioModelId, setScenarioModelId] = useState(null)
  const [showOpener, setShowOpener] = useState(false)
  const [openerDraft, setOpenerDraft] = useState('')
  const [addingOpener, setAddingOpener] = useState(false)
  const testInflightRef = useRef(false)
  const openerInflightRef = useRef(false)
  const testBottomRef = useRef(null)

  // ----- data loading -----

  const loadChats = useCallback(() => {
    apiGet('/api/scenarios/builder-chats').then(r => r.json())
      .then(d => setChats(d.chats || []))
      .catch(() => setChats([]))
  }, [])

  const loadScenarios = useCallback(() => {
    apiGet('/api/scenarios').then(r => r.json())
      .then(d => setScenarios(d.scenarios || []))
      .catch(() => setScenarios([]))
  }, [])

  useEffect(() => {
    fetchWithWorkspace('/api/ai-models').then(r => r.json()).then(d => setAiModels(d.models || [])).catch(() => {})
    fetchWithWorkspace('/api/phone-numbers').then(r => r.json()).then(d => setPhoneNumbers(d.phoneNumbers || [])).catch(() => {})
    apiGet('/api/contact-lists').then(r => r.json()).then(d => setContactLists(d.contactLists || [])).catch(() => {})
    loadChats()
    loadScenarios()
    // ?test=<scenarioId> → open that scenario in test mode straight away.
    try {
      const t = new URLSearchParams(window.location.search).get('test')
      if (t) openTest(t, '')
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Builder auto-scroll — only when the thread grows.
  useEffect(() => {
    if (mode !== 'builder') return
    if (thread.length > prevLenRef.current || drafting || creatingScenario) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevLenRef.current = thread.length
  }, [thread, drafting, creatingScenario, mode])

  // Test-chat auto-scroll.
  useEffect(() => {
    if (mode === 'test') testBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [testMessages, testSending, mode])

  // ----- test mode: open / sessions / messages -----

  const openTest = (id, nameHint = '', fromCreate = false) => {
    setError('')
    setCreatedNote(fromCreate)
    setShowOpener(false)
    setOpenerDraft('')
    setTestInput('')
    setTestScenario({ id, name: nameHint })
    setMode('test')
  }

  useEffect(() => {
    if (mode !== 'test' || !testScenario?.id) return
    const id = testScenario.id
    let cancelled = false
    setSessions(null)
    setActiveSessionId(null)
    setTestMessages([])
    fetchWithWorkspace(`/api/scenarios/${id}/sandbox`).then(r => r.json()).then(d => {
      if (cancelled) return
      setTestScenario(p => (p && p.id === id ? { ...p, name: d.scenario?.name || p.name } : p))
      setScenarioModelId(d.scenario?.ai_model || null)
      setSessions(d.sessions || [])
      if ((d.sessions || []).length > 0) setActiveSessionId(d.sessions[0].id)   // most recent
    }).catch(() => { if (!cancelled) setSessions([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, testScenario?.id])

  useEffect(() => {
    if (mode !== 'test' || !testScenario?.id || !activeSessionId) { setTestMessages([]); return }
    // A send in flight owns the message list (it appends the server copies
    // itself) — refetching now would clobber the optimistic bubble or race in
    // a duplicate. The send's own update supersedes this load.
    if (testInflightRef.current) return
    let cancelled = false
    setLoadingMessages(true)
    fetchWithWorkspace(`/api/scenarios/${testScenario.id}/sandbox/${activeSessionId}/messages`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setTestMessages(d.messages || []) })
      .catch(() => { if (!cancelled) setTestMessages([]) })
      .finally(() => { if (!cancelled) setLoadingMessages(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, testScenario?.id, activeSessionId])

  const newTestChat = async () => {
    if (!testScenario?.id) return
    setError('')
    try {
      const res = await fetchWithWorkspace(`/api/scenarios/${testScenario.id}/sandbox`, { method: 'POST', body: JSON.stringify({}) })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create test chat')
      setSessions(p => [data.session, ...(p || [])])
      setActiveSessionId(data.session.id)
      setTestMessages([])
    } catch (e) { setError(e.message) }
  }

  const ensureSession = async () => {
    if (activeSessionId) return activeSessionId
    const res = await fetchWithWorkspace(`/api/scenarios/${testScenario.id}/sandbox`, { method: 'POST', body: JSON.stringify({}) })
    const data = await res.json()
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create test chat')
    setSessions(p => [data.session, ...(p || [])])
    setActiveSessionId(data.session.id)
    return data.session.id
  }

  const testSend = async () => {
    const text = testInput.trim()
    if (!text || testInflightRef.current) return
    testInflightRef.current = true
    setError('')
    setTestInput('')
    setTestSending(true)
    const tempId = `temp-${Math.random()}`
    setTestMessages(prev => [...prev, { id: tempId, direction: 'inbound', body: text, created_at: new Date().toISOString() }])
    try {
      const sessionId = await ensureSession()
      const res = await fetchWithWorkspace(`/api/scenarios/${testScenario.id}/sandbox/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'The AI could not reply. Try again.')
      // Dedupe by id: when the first send auto-creates the session, the
      // session-load effect can race in with the server's copy of this same
      // message before we append it here — filtering by id keeps exactly one.
      setTestMessages(prev => {
        const drop = new Set([tempId, data.message?.id, data.reply?.id].filter(Boolean))
        return [
          ...prev.filter(m => !drop.has(m.id)),
          data.message,
          ...(data.reply ? [data.reply] : []),
        ]
      })
    } catch (e) {
      setError(e.message)
      setTestMessages(prev => prev.filter(m => m.id !== tempId))
      setTestInput(text)
    } finally {
      setTestSending(false)
      testInflightRef.current = false
    }
  }

  // Campaign/automation opening text — first outbound bubble, no AI reply.
  const addOpener = async () => {
    const text = openerDraft.trim()
    if (!text || openerInflightRef.current) return
    openerInflightRef.current = true
    setError('')
    setAddingOpener(true)
    try {
      const sessionId = await ensureSession()
      const res = await fetchWithWorkspace(`/api/scenarios/${testScenario.id}/sandbox/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text, opener: true }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to add opening text')
      setTestMessages(prev => [...prev, data.opener])
      setOpenerDraft('')
      setShowOpener(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setAddingOpener(false)
      openerInflightRef.current = false
    }
  }

  // ----- chat lifecycle: new / open / delete / persist -----

  const startNewChat = () => {
    setMode('builder')
    setChatId(null)
    setChatScenarioId(null)
    setTestScenario(null)
    setCreatedNote(false)
    setUpdatedNote(false)
    setError('')
    setThread([])
    setTranscript([])
    setName('')
    setInstructions('')
    setStatusLine('')
    setPromptAccepted(false)
    setInput('')
    setRefineInput('')
    setPhoneIds([])
    setAudience('all')
    setListIds([])
    setListOpen(false)
    setListSearch('')
    setEnableFollowups(false)
    setAttempts(3)
    setKeywords(DEFAULT_KEYWORDS)
    setKeywordInput('')
    setReplyMode('anytime')
    setBooksAppointments(true)
    setAiModel('')
    booksTouched.current = false
    premappedRef.current = new Set()
    createdRef.current = false
    setCreatingScenario(false)
    setCreateFailed(false)
    setConfirmDelete(null)
    setMenuOpenId(null)
    setFormScenario(null)
  }

  // First user send in a new chat → create the server-side chat record.
  const ensureChat = async firstText => {
    if (chatId) return chatId
    try {
      const res = await fetchWithWorkspace('/api/scenarios/builder-chats', {
        method: 'POST',
        body: JSON.stringify({ title: firstText.slice(0, 60) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.chat?.id) {
        setChatId(data.chat.id)
        loadChats()
        return data.chat.id
      }
    } catch { /* persistence is best-effort; chatting still works */ }
    return null
  }

  const deleteChat = async id => {
    setConfirmDelete(null)
    try {
      await fetchWithWorkspace(`/api/scenarios/builder-chats/${id}`, { method: 'DELETE' })
    } catch { /* noop */ }
    if (id === chatId) startNewChat()
    loadChats()
  }

  // ----- scenario row actions (replaces the old management page) -----

  const toggleActive = async s => {
    setMenuOpenId(null)
    try {
      const res = await fetchWithWorkspace(`/api/scenarios/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !s.is_active }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.success === false) throw new Error(d.error || 'Failed to update scenario')
      loadScenarios()
    } catch (e) {
      setError(e.message || 'Failed to update scenario')
    }
  }

  const deleteScenarioRow = async (id, linkedChatId) => {
    setConfirmDelete(null)
    try {
      const res = await fetchWithWorkspace(`/api/scenarios/${id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.success === false) throw new Error(d.error || 'Failed to delete scenario')
      if (linkedChatId) {
        await fetchWithWorkspace(`/api/scenarios/builder-chats/${linkedChatId}`, { method: 'DELETE' }).catch(() => {})
      }
      // If the deleted scenario is what's on screen, reset the main panel.
      if (chatScenarioId === id || testScenario?.id === id || formScenario?.id === id || (linkedChatId && linkedChatId === chatId)) {
        startNewChat()
      }
      loadScenarios()
      loadChats()
    } catch (e) {
      setError(e.message || 'Failed to delete scenario')
    }
  }

  // Clicking a scenario opens its EDITABLE FORM (embedded ScenarioForm);
  // the [ Form | Chat ] toggle switches to the stored builder chat, if any.
  const openForm = (id, scenarioName = '', linkedChatId = null) => {
    setError('')
    setMenuOpenId(null)
    setConfirmDelete(null)
    setFormScenario({ id, name: scenarioName, chatId: linkedChatId })
    setMode('form')
  }

  // Full draft snapshot for persistence.
  const answeredFieldValue = f => ({
    phone_number_ids: phoneIds,
    contact_list_ids: audience === 'lists' ? listIds : [],
    enable_followups: enableFollowups,
    auto_stop_keywords: keywords,
    ai_reply_mode: replyMode,
    books_appointments: booksAppointments,
  })[f]

  const buildSnapshot = () => {
    const answered = {}
    QUEUE.forEach(f => {
      if (thread.some(x => x.type === 'step' && x.field === f && x.status === 'done')) {
        answered[f] = answeredFieldValue(f)
      }
    })
    if ('enable_followups' in answered) answered.max_followup_attempts = attempts
    return {
      name,
      instructions,
      promptAccepted,
      answered,
      premapped: [...premappedRef.current],
      aiModel,
      scenarioId: chatScenarioId,
    }
  }

  // Debounced PATCH after every meaningful change (draft edits, accepted
  // prompt, answered steps, created scenario).
  useEffect(() => {
    if (!chatId) return
    if (skipSaveRef.current) { skipSaveRef.current = false; return }
    const snapshot = buildSnapshot()
    const tmr = setTimeout(() => {
      fetchWithWorkspace(`/api/scenarios/builder-chats/${chatId}`, {
        method: 'PATCH',
        body: JSON.stringify({ draft: snapshot, ...(chatScenarioId ? { scenario_id: chatScenarioId } : {}) }),
      }).catch(() => {})
    }, 600)
    return () => clearTimeout(tmr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, name, instructions, promptAccepted, thread, phoneIds, audience, listIds,
      enableFollowups, attempts, keywords, replyMode, booksAppointments, aiModel, chatScenarioId])

  // Reopen a chat from the sidebar: rebuild the thread from messages + draft.
  const openChat = async id => {
    setError('')
    setConfirmDelete(null)
    setMenuOpenId(null)
    try {
      const res = await apiGet(`/api/scenarios/builder-chats/${id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to open chat')
      const chat = data.chat || {}
      const draft = chat.draft || {}
      const msgs = data.messages || []
      const premapped = draft.premapped || []
      const answered = draft.answered || {}
      const hasDraft = typeof draft.instructions === 'string' && draft.instructions.trim().length > 0
      const accepted = !!draft.promptAccepted && hasDraft
      const sid = chat.scenario_id || draft.scenarioId || null

      startNewChat()
      skipSaveRef.current = true
      setChatId(id)
      setTranscript(msgs.map(m => ({ role: m.role, content: m.content })))
      premappedRef.current = new Set(premapped)

      // Restore values.
      if (hasDraft) { setName(draft.name || ''); setInstructions(draft.instructions) }
      setPromptAccepted(accepted)
      setAiModel(draft.aiModel || '')
      if ('phone_number_ids' in answered) setPhoneIds(answered.phone_number_ids || [])
      if ('contact_list_ids' in answered) {
        const v = answered.contact_list_ids || []
        setAudience(v.length ? 'lists' : 'all')
        setListIds(v)
      }
      if ('enable_followups' in answered) setEnableFollowups(!!answered.enable_followups)
      if ('max_followup_attempts' in answered) setAttempts(Number(answered.max_followup_attempts) || 3)
      if ('auto_stop_keywords' in answered) setKeywords(answered.auto_stop_keywords || [])
      if ('ai_reply_mode' in answered) setReplyMode(answered.ai_reply_mode || 'anytime')
      if ('books_appointments' in answered) { setBooksAppointments(!!answered.books_appointments); booksTouched.current = true }
      setChatScenarioId(sid)

      // Rebuild the thread: text bubbles → prompt card → ✓ lines → next widget.
      let items = msgs.map(m => ({ id: nid(), type: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
      if (hasDraft) items.push({ id: nid(), type: 'prompt', status: accepted ? 'accepted' : 'open' })
      for (const f of QUEUE) {
        if (f in answered) items.push({ id: nid(), type: 'step', field: f, status: 'done', premapped: premapped.includes(f) })
      }
      const allAnswered = QUEUE.every(f => f in answered)
      if (accepted && !sid && !allAnswered) items = ensureProgress(items)
      setThread(items)

      // Never auto-create on open; a completed-but-uncreated chat gets the
      // retry bar instead of a surprise POST.
      createdRef.current = true
      if (!sid && !(accepted && allAnswered)) createdRef.current = false
      setCreateFailed(!sid && accepted && allAnswered)

      // Always open the CHAT itself — testing is one click away via the
      // "Test" button in the header (auto-opening test hid the conversation).
      setMode('builder')
    } catch (e) {
      setError(e.message || 'Failed to open chat')
    }
  }

  // ----- queue engine -----

  // Walk QUEUE in order. Answered fields keep their item (or get a compact
  // pre-mapped confirmation appended). The first unanswered field gets an
  // active widget; when all are answered the create effect takes over.
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
    return t
  }

  const queueComplete = promptAccepted &&
    QUEUE.every(f => thread.some(x => x.type === 'step' && x.field === f && x.status === 'done'))

  // Last step answered → create immediately (only for chats without a scenario).
  useEffect(() => {
    if (queueComplete && !createdRef.current && !chatScenarioId) {
      createdRef.current = true
      createScenario()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueComplete])

  const completeSteps = fields => {
    setListOpen(false)
    setThread(t => ensureProgress(t.map(x =>
      x.type === 'step' && fields.includes(x.field) ? { ...x, status: 'done', hint: null } : x)))
  }

  // "Change" on a ✓ line — reopen that widget in place.
  const reopenStep = field => {
    setError('')
    setThread(t => t.map(x => (x.type === 'step' && x.field === field ? { ...x, status: 'active', hint: null } : x)))
  }

  // ----- settings extraction (pre-mapping) -----

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
    if ('ai_model' in settings) setAiModel(settings.ai_model || '')
    applied.forEach(f => premappedRef.current.add(f))
    return applied
  }

  // Post-create chats: extracted settings must hit the real scenario, not
  // just local state — PATCH first, and only reflect the change in the
  // ✓ lines when the server accepted it (the assistant must never claim a
  // change that didn't happen).
  const patchScenarioSettings = async settings => {
    if (!settings || typeof settings !== 'object') return []
    if (updateInflightRef.current) return []
    const payload = {}
    if ('phone_number_ids' in settings) payload.phoneNumbers = settings.phone_number_ids || []
    if ('contact_list_ids' in settings) payload.contact_list_ids = settings.contact_list_ids || []
    if ('enable_followups' in settings) payload.enable_followups = !!settings.enable_followups
    if ('max_followup_attempts' in settings) payload.max_followup_attempts = Number(settings.max_followup_attempts) || 3
    if ('auto_stop_keywords' in settings) payload.auto_stop_keywords = settings.auto_stop_keywords || []
    if ('ai_reply_mode' in settings) payload.ai_reply_mode = settings.ai_reply_mode
    if ('books_appointments' in settings) payload.books_appointments = !!settings.books_appointments
    if ('ai_model' in settings) payload.ai_model = settings.ai_model || null
    if (Object.keys(payload).length === 0) return []
    updateInflightRef.current = true
    try {
      const res = await fetchWithWorkspace(`/api/scenarios/${chatScenarioId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.success === false) throw new Error(d.error || 'Failed to update the scenario')
      setUpdatedNote(true)
      return applySettings(settings)   // sync local state + ✓ line values
    } catch (e) {
      setError(e.message || 'Failed to update the scenario')
      return []
    } finally {
      updateInflightRef.current = false
    }
  }

  // ----- builder-chat round-trips -----

  const handleUserText = async (text, restore, source = 'composer') => {
    const trimmed = (text || '').trim()
    if (!trimmed || builderInflightRef.current) return
    builderInflightRef.current = true
    setError('')
    const baseTranscript = transcript
    const apiMessages = [...baseTranscript, { role: 'user', content: trimmed }]
    const bubbleId = nid()
    setTranscript(apiMessages)
    setThread(t => [...t, { id: bubbleId, type: 'user', content: trimmed }])
    setDrafting(true)
    try {
      const currentChatId = await ensureChat(trimmed)
      const res = await apiPost('/api/scenarios/builder-chat', {
        messages: apiMessages,
        current: { name, instructions },   // includes any hand edits
        ...(currentChatId ? { chat_id: currentChatId } : {}),   // server persists the turns
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) throw new Error(data.error || 'The assistant could not reply. Please try again.')
      setTranscript([...apiMessages, { role: 'assistant', content: data.reply || '' }])
      // Greetings/small-talk come back with empty instructions — that is a
      // conversational reply, NOT a draft. Only touch the prompt document
      // when the response actually carries instructions.
      const hasDraft = typeof data.instructions === 'string' && data.instructions.trim().length > 0
      // Only card-refine sends surface the reply in the card's status line —
      // the user is looking at the card there. Main-composer replies must be
      // visible bubbles at the thread end (chronological), or the chat looks
      // unanswered.
      const fromComposer = source !== 'refine'
      if (hasDraft) {
        if (data.name) setName(data.name)
        setInstructions(data.instructions)
        if (!fromComposer) setStatusLine(data.reply || '')
      }
      const applied = chatScenarioId
        ? await patchScenarioSettings(data.settings)   // PATCH the real scenario first
        : applySettings(data.settings)

      const replyBubble = () => ({ id: nid(), type: 'assistant', content: data.reply || '' })

      if (!promptAccepted) {
        setThread(t => {
          const cardExists = t.some(x => x.type === 'prompt')
          if (!cardExists) {
            return hasDraft
              ? [...t, replyBubble(), { id: nid(), type: 'prompt', status: 'open' }]
              : [...t, replyBubble()]
          }
          // Card exists: refine sends are absorbed in place (status line);
          // composer sends and conversational answers get a reply bubble.
          return (hasDraft && !fromComposer) ? t : [...t, replyBubble()]
        })
      } else {
        // Queue phase: free-text answers are extracted server-side. The reply
        // always lands as a bubble (only the composer sends here).
        setThread(t => {
          const hadActive = t.some(x => x.type === 'step' && x.status === 'active')
          if (applied.length) {
            const next = t.map(x => (x.type === 'step' && applied.includes(x.field) ? { ...x, status: 'done', hint: null } : x))
            return ensureProgress([...next, replyBubble()])
          }
          if (hadActive) {
            return [
              ...t.map(x => (x.type === 'step' && x.status === 'active'
                ? { ...x, hint: 'Use the options below, or try rephrasing.' } : x)),
              replyBubble(),
            ]
          }
          return [...t, replyBubble()]
        })
      }
    } catch (e) {
      setError(e.message || 'Something went wrong. Please try again.')
      setTranscript(baseTranscript)
      setThread(t => t.filter(x => x.id !== bubbleId))
      restore?.(trimmed)
    } finally {
      setDrafting(false)
      builderInflightRef.current = false
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
    handleUserText(text, setRefineInput, 'refine')
  }

  // ----- prompt accept: start the queue, or UPDATE the existing scenario -----

  const acceptPrompt = async () => {
    if (drafting || creatingScenario || !instructions.trim()) return
    setError('')

    // Reopened chat that already produced a scenario → update it, no duplicate.
    if (chatScenarioId) {
      if (updateInflightRef.current) return
      updateInflightRef.current = true
      setPromptAccepted(true)
      setThread(t => t.map(x => (x.type === 'prompt' ? { ...x, status: 'accepted' } : x)))
      try {
        const res = await fetchWithWorkspace(`/api/scenarios/${chatScenarioId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim(), instructions }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.success === false) throw new Error(data.error || 'Failed to update the scenario')
        setUpdatedNote(true)
        setThread(t => [...t, { id: nid(), type: 'assistant', content: 'Scenario updated.' }])
        setTestScenario(p => (p && p.id === chatScenarioId ? { ...p, name: name.trim() } : p))
      } catch (e) {
        setError(e.message || 'Failed to update the scenario')
        setPromptAccepted(false)
        setThread(t => t.map(x => (x.type === 'prompt' ? { ...x, status: 'open' } : x)))
      } finally {
        updateInflightRef.current = false
      }
      return
    }

    // New scenario → walk the setup queue.
    if (!booksTouched.current && !premappedRef.current.has('books_appointments')) {
      setBooksAppointments(/book|appointment|schedule/i.test(instructions))
    }
    if (createFailed) { createdRef.current = false; setCreateFailed(false) }
    setPromptAccepted(true)
    setThread(t => ensureProgress(t.map(x => (x.type === 'prompt' ? { ...x, status: 'accepted' } : x))))
  }

  // Reopen the prompt document at the end of the thread ("Edit").
  const openPromptCard = () => {
    setPromptAccepted(false)
    setUpdatedNote(false)
    setError('')
    setMode('builder')
    setThread(t => [
      ...t.filter(x => x.type !== 'prompt'),
      { id: nid(), type: 'prompt', status: 'open' },
    ])
  }

  // ----- create -----

  const createScenario = async () => {
    if (createInflightRef.current) return
    if (!name.trim() || !instructions.trim() || !phoneIds.length) return
    createInflightRef.current = true
    setCreatingScenario(true)
    setCreateFailed(false)
    setError('')
    try {
      const res = await apiPost('/api/scenarios', {
        name: name.trim(),
        instructions,
        phoneNumbers: phoneIds,
        contact_list_ids: audience === 'lists' ? listIds : [],   // [] = everyone
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
      const sid = data.scenario.id
      setChatScenarioId(sid)
      if (chatId) {
        // Link the chat AND retitle it to the scenario name (titles stay auto).
        fetchWithWorkspace(`/api/scenarios/builder-chats/${chatId}`, {
          method: 'PATCH',
          body: JSON.stringify({ scenario_id: sid, title: name.trim() }),
        }).then(() => loadChats()).catch(() => {})
      }
      loadChats()
      loadScenarios()   // new row appears with its green dot
      openTest(sid, name.trim(), true)
    } catch (e) {
      setError(e.message || 'Failed to create scenario')
      setCreateFailed(true)
    } finally {
      setCreatingScenario(false)
      createInflightRef.current = false
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
  const testModel = scenarioModelId
    ? aiModels.find(m => m.id === scenarioModelId)
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
    <button type="button" onClick={onClick} disabled={disabled || drafting || creatingScenario}
      className="px-4 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-40">
      {label}
    </button>
  )

  const widgetBody = field => {
    switch (field) {
      case 'phone_number_ids':
        return {
          title: 'Which line should it answer on?',
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
          body: (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { v: 'anytime', t: 'Respond anytime', d: 'Replies 24/7, books within business hours.' },
                { v: 'business_hours', t: 'Only during business hours', d: 'Defers replies to the next opening.' },
              ].map(o => (
                <button key={o.v} type="button" onClick={() => setReplyMode(o.v)}
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
          hint: `Suggested: ${booksAppointments ? 'Yes' : 'No'} — based on your prompt.`,
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

      default:
        return { title: field, body: null, footer: continueBtn(() => completeSteps([field])) }
    }
  }

  // ----- thread item renderers -----

  const renderStep = item => {
    if (item.status !== 'active') {
      const s = stepSummary(item.field)
      return (
        <div key={item.id} className="flex justify-start">
          <div className="inline-flex items-center gap-2 max-w-full text-xs text-[#5C5A55] bg-white border border-[#E3E1DB] rounded-full px-3 py-1.5">
            <i className="fas fa-check text-[#1F8C4A] text-[10px] shrink-0" />
            <span className="truncate">
              <span className="font-medium text-[#131210]">{s.label}:</span> {s.value}
              {item.premapped && <span className="text-[#9B9890]"> (you mentioned it)</span>}
            </span>
            {!chatScenarioId && (
              <button type="button" onClick={() => reopenStep(item.field)}
                className="text-[#D63B1F] font-medium hover:underline shrink-0">
                Change
              </button>
            )}
          </div>
        </div>
      )
    }
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
                <button type="button" onClick={acceptPrompt} disabled={drafting || creatingScenario || !instructions.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-40 shrink-0">
                  {chatScenarioId ? 'Update scenario' : 'Use this prompt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ----- composer model dropdown (Monday.com-style, opens downward) -----

  const modelDropdown = (
    <div className="relative">
      <button type="button" onClick={() => setModelOpen(v => !v)}
        title="Which AI writes the replies"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[#5C5A55] border border-transparent hover:border-[#E3E1DB] hover:bg-[#F7F6F3]">
        {selectedModel
          ? <VendorLogo vendor={selectedModel.vendor} size={16} />
          : <i className="fas fa-microchip text-[11px] text-[#9B9890]" />}
        <span className="max-w-[140px] truncate">{selectedModel ? selectedModel.label : 'AI model'}</span>
        <i className={`fas fa-chevron-${modelOpen ? 'up' : 'down'} text-[9px] text-[#9B9890]`} />
      </button>
      {modelOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setModelOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-30 w-80 bg-white border border-[#E3E1DB] rounded-2xl shadow-xl p-2">
            {aiModels.length === 0 && <p className="px-3 py-2.5 text-sm text-[#9B9890]">Loading models…</p>}
            {aiModels.map(m => (
              <button key={m.id} type="button" disabled={!m.available}
                onClick={() => { setAiModel(m.id); setModelOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl ${
                  m.available
                    ? (selectedModel?.id === m.id ? 'bg-[#F7F6F3]' : 'hover:bg-[#F7F6F3]')
                    : 'cursor-not-allowed'
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
        </>
      )}
    </div>
  )

  // ----- builder view -----

  const builderView = thread.length === 0 ? (
    /* Hero */
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 pt-14 md:pt-20 pb-10 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#D63B1F] flex items-center justify-center mx-auto mb-5 shadow-sm">
          <i className="fas fa-wand-magic-sparkles text-white text-xl" />
        </div>
        <h1 className="text-2xl md:text-3xl font-semibold text-[#131210] tracking-tight">
          Build your <span className="text-[#D63B1F]">AI</span> texting agent
        </h1>
        <p className="text-xs text-[#9B9890] mt-2 mb-6 max-w-lg mx-auto leading-relaxed">
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
          <div className="flex items-center justify-end gap-2 px-3 pb-2.5 pt-1">
            {modelDropdown}
            <button type="button" onClick={send} disabled={drafting || !input.trim()} title="Send"
              className="w-8 h-8 rounded-full bg-[#D63B1F] hover:bg-[#c23119] text-white flex items-center justify-center disabled:opacity-40 shrink-0">
              <i className="fas fa-arrow-up text-xs" />
            </button>
          </div>
        </div>

        {drafting ? (
          <p className="flex items-center justify-center gap-2.5 text-xs text-[#5C5A55] mt-5">
            <TypingDots /> Writing your prompt…
          </p>
        ) : (
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {SUGGESTIONS.map(s => (
              <button key={s} type="button" onClick={() => { setInput(s); inputRef.current?.focus() }}
                className="px-3.5 py-2 text-xs text-[#5C5A55] bg-white border border-[#E3E1DB] rounded-full hover:border-[#D63B1F]/40 hover:text-[#131210] transition-colors">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : (
    /* Thread */
    <div className="flex-1 flex flex-col min-h-0">
      {updatedNote && (
        <div className="px-5 py-2 text-xs bg-[rgba(31,140,74,0.06)] border-b border-[rgba(31,140,74,0.16)] text-[#1F8C4A] shrink-0">
          <i className="fas fa-check-circle mr-1.5" />Scenario updated.
        </div>
      )}
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
          {(drafting || creatingScenario) && (
            <div className="flex justify-start">
              <div className="bg-white border border-[#E3E1DB] px-4 py-3 rounded-2xl rounded-bl-md">
                <span className="inline-flex items-center gap-2.5 text-xs text-[#5C5A55]">
                  <TypingDots />
                  {creatingScenario ? 'Creating your scenario…' : promptAccepted ? 'Checking…' : 'Writing your prompt…'}
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {createFailed && !creatingScenario && (
        <div className="border-t border-[#E3E1DB] bg-white px-4 md:px-8 py-2 shrink-0">
          <div className="max-w-3xl mx-auto flex items-center justify-end gap-3">
            <p className="text-[11px] text-[#9B9890]">The scenario wasn&rsquo;t created.</p>
            <button type="button" onClick={createScenario}
              className="px-4 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg">
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Composer — refines and free-text answers */}
      <div className="border-t border-[#E3E1DB] bg-white px-4 md:px-8 py-3 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white border border-[#E3E1DB] rounded-2xl focus-within:border-[#D63B1F] focus-within:ring-2 focus-within:ring-[#D63B1F]/10 flex items-end gap-2 pr-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1}
              placeholder={promptAccepted
                ? 'Type an answer, or use the options above…'
                : 'Tell me what to change about the prompt…'}
              className="flex-1 px-4 py-3 text-sm text-[#131210] placeholder-[#9B9890] bg-transparent rounded-2xl resize-none focus:outline-none"
            />
            <button type="button" onClick={send} disabled={drafting || !input.trim()} title="Send"
              className="mb-2 w-8 h-8 rounded-full bg-[#D63B1F] hover:bg-[#c23119] text-white flex items-center justify-center disabled:opacity-40 shrink-0">
              <i className="fas fa-arrow-up text-xs" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  // ----- test view -----

  const testView = (
    <div className="flex-1 flex flex-col min-h-0">
      {createdNote && (
        <div className="px-5 py-2 text-xs bg-[rgba(31,140,74,0.06)] border-b border-[rgba(31,140,74,0.16)] text-[#1F8C4A] shrink-0">
          <i className="fas fa-check-circle mr-1.5" />Created — test it below.
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="max-w-2xl mx-auto space-y-3">
          {sessions === null || loadingMessages ? (
            <p className="text-center text-xs text-[#9B9890] py-10">Loading…</p>
          ) : testMessages.length === 0 && !testSending ? (
            // Clean empty state — the composer placeholder carries the hint.
            <div className="py-12" />
          ) : (
            testMessages.map(m => {
              const isLead = m.direction === 'inbound'
              if (!isLead && m.meta?.stopped) {
                return (
                  <div key={m.id} className="flex justify-center">
                    <span className="text-[11px] px-3 py-1.5 rounded-full bg-[#EFEDE8] text-[#5C5A55]">
                      <i className="fas fa-hand mr-1.5 text-[10px]" />The AI chose to stop replying here
                    </span>
                  </div>
                )
              }
              const unresolved = m.meta?.unresolved_tokens || []
              return (
                <div key={m.id}>
                  <div className={`flex ${isLead ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      isLead
                        ? 'bg-[#D63B1F] text-white rounded-br-md'
                        : 'bg-white border border-[#E3E1DB] text-[#131210] rounded-bl-md'
                    }`}>
                      {m.body}
                      <p className={`text-[10px] mt-1 ${isLead ? 'text-white/70 text-right' : 'text-[#9B9890]'}`}>
                        {isLead ? 'You (as the lead)' : m.meta?.opener ? 'Your opening text' : 'AI'} · {fmtTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                  {!isLead && m.meta?.human_needed && (
                    <div className="flex justify-center mt-2">
                      <span className="text-[11px] px-3 py-1.5 rounded-full bg-[rgba(214,59,31,0.07)] text-[#D63B1F] border border-[rgba(214,59,31,0.16)]">
                        <i className="fas fa-user mr-1.5 text-[10px]" />The AI asked for a human here and would stop
                      </span>
                    </div>
                  )}
                  {!isLead && unresolved.length > 0 && (
                    <div className="flex justify-center mt-2">
                      <span className="text-[11px] px-3 py-1.5 rounded-full bg-[rgba(214,59,31,0.07)] text-[#D63B1F] border border-[rgba(214,59,31,0.16)]">
                        <i className="fas fa-triangle-exclamation mr-1.5 text-[10px]" />
                        {unresolved.map(t => `{{${t}}}`).join(', ')} blank in tests — real sends fill {unresolved.length === 1 ? 'it' : 'them'} from contact data
                      </span>
                    </div>
                  )}
                </div>
              )
            })
          )}
          {testSending && (
            <div className="flex justify-start">
              <div className="bg-white border border-[#E3E1DB] px-4 py-3 rounded-2xl rounded-bl-md">
                <TypingDots />
              </div>
            </div>
          )}
          <div ref={testBottomRef} />
        </div>
      </div>

      {/* Test composer */}
      <div className="border-t border-[#E3E1DB] bg-white px-4 md:px-8 py-3 shrink-0">
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <textarea
            value={testInput}
            onChange={e => setTestInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); testSend() } }}
            placeholder="Type what a lead might send…"
            rows={1}
            className="flex-1 px-3.5 py-2.5 border border-[#D4D1C9] rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
          />
          <button type="button" onClick={testSend} disabled={testSending || !testInput.trim()}
            className="px-4 py-2.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-xl disabled:opacity-50 shrink-0">
            <i className="fas fa-paper-plane" />
          </button>
        </div>
        <p className="max-w-2xl mx-auto text-[10px] text-[#9B9890] mt-1.5">
          Replying with {testModel ? testModel.label : '…'} · to change the model, edit the scenario
        </p>
      </div>
    </div>
  )

  // ----- form view (embedded editable ScenarioForm + Form/Chat toggle) -----

  const formView = formScenario ? (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Slim studio strip: segmented [ Form | Chat ] toggle */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-[#E3E1DB] bg-white shrink-0">
        <div className="inline-flex rounded-lg border border-[#E3E1DB] bg-[#F7F6F3] p-0.5">
          <button type="button"
            className="px-3 py-1 text-xs font-medium rounded-md bg-white text-[#131210] shadow-sm">
            Form
          </button>
          <button type="button" disabled={!formScenario.chatId}
            onClick={() => formScenario.chatId && openChat(formScenario.chatId)}
            title={formScenario.chatId ? 'Continue editing conversationally' : 'No builder chat for this scenario'}
            className={`px-3 py-1 text-xs font-medium rounded-md ${
              formScenario.chatId ? 'text-[#5C5A55] hover:text-[#131210]' : 'text-[#C9C6BE] cursor-not-allowed'
            }`}>
            Chat
          </button>
        </div>
        <p className="text-xs text-[#9B9890] truncate flex-1 min-w-0">{formScenario.name}</p>
      </div>
      {/* Embedded edit form (its own top bar handles Save/Test/Cancel) */}
      <div className="flex-1 min-h-0">
        <ScenarioForm key={formScenario.id} mode="edit" scenarioId={formScenario.id} />
      </div>
    </div>
  ) : null

  // ----- render -----

  return (
    <div className="h-full flex bg-[#F7F6F3]">
      {/* LEFT — scenarios (merged with their builder chats) */}
      {sidebarCollapsed ? (
        <aside className="hidden md:flex flex-col items-center gap-1.5 w-12 shrink-0 bg-white border-r border-[#E3E1DB] py-3">
          <button type="button" onClick={() => setSidebarCollapsed(false)} title="Expand scenarios"
            className="w-8 h-8 rounded-lg text-[#5C5A55] hover:bg-[#F7F6F3] flex items-center justify-center">
            <i className="fas fa-chevron-right text-xs" />
          </button>
          <button type="button" onClick={startNewChat} title="New scenario"
            className="w-8 h-8 rounded-lg bg-[#D63B1F] hover:bg-[#c23119] text-white flex items-center justify-center">
            <i className="fas fa-plus text-xs" />
          </button>
        </aside>
      ) : (
        <aside className="hidden md:flex flex-col w-60 shrink-0 bg-white border-r border-[#E3E1DB]">
          <div className="p-3 pb-2 flex items-center gap-2">
            <button type="button" onClick={startNewChat}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg">
              + New scenario
            </button>
            <button type="button" onClick={() => setSidebarCollapsed(true)} title="Collapse"
              className="w-8 h-8 rounded-lg text-[#9B9890] hover:bg-[#F7F6F3] hover:text-[#5C5A55] flex items-center justify-center shrink-0">
              <i className="fas fa-chevron-left text-xs" />
            </button>
          </div>
          <div className="px-3 pb-2">
            <div className="relative">
              <i className="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9B9890] text-[10px]" />
              <input value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)}
                placeholder="Search scenarios…"
                className="w-full pl-7 pr-2.5 py-1.5 border border-[#E3E1DB] rounded-lg text-xs focus:outline-none focus:border-[#D63B1F]" />
            </div>
          </div>
          <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#9B9890]">Scenarios</p>
          <div className="flex-1 overflow-y-auto pb-3">
            {(() => {
              if (scenarios === null || chats === null) {
                return <p className="px-4 py-2 text-xs text-[#9B9890]">Loading…</p>
              }
              // One row per SCENARIO (matched to its chat by scenario_id);
              // chats that haven't produced a scenario yet show as drafts.
              const chatByScenario = new Map()
              const drafts = []
              for (const c of chats) {
                if (c.scenario_id) { if (!chatByScenario.has(c.scenario_id)) chatByScenario.set(c.scenario_id, c) }
                else drafts.push(c)
              }
              const q = sidebarSearch.trim().toLowerCase()
              const rows = [
                ...scenarios
                  .filter(s => !q || (s.name || '').toLowerCase().includes(q))
                  .map(s => ({ key: `s-${s.id}`, kind: 'scenario', scenario: s, chat: chatByScenario.get(s.id) || null })),
                ...drafts
                  .filter(c => !q || (c.title || '').toLowerCase().includes(q))
                  .map(c => ({ key: `d-${c.id}`, kind: 'draft', chat: c })),
              ]
              if (rows.length === 0) {
                return <p className="px-4 py-2 text-xs text-[#9B9890] leading-relaxed">{q ? 'No matches.' : 'No scenarios yet.'}</p>
              }
              return rows.map(row => {
                const isDraft = row.kind === 'draft'
                const current = isDraft
                  ? (mode === 'builder' && chatId === row.chat.id)
                  : ((mode === 'form' && formScenario?.id === row.scenario.id) ||
                     (mode === 'test' && testScenario?.id === row.scenario.id) ||
                     (mode === 'builder' && row.chat && chatId === row.chat.id))
                const deleting = confirmDelete &&
                  ((isDraft && confirmDelete.kind === 'chat' && confirmDelete.id === row.chat.id) ||
                   (!isDraft && confirmDelete.kind === 'scenario' && confirmDelete.id === row.scenario.id))
                if (deleting) {
                  return (
                    <div key={row.key} className="flex items-center gap-2 px-4 py-2 bg-[rgba(214,59,31,0.05)]">
                      <span className="flex-1 min-w-0 truncate text-xs text-[#D63B1F] font-medium">
                        Delete{isDraft ? ' draft' : ''}?
                      </span>
                      <button type="button" title="Confirm delete"
                        onClick={() => isDraft ? deleteChat(confirmDelete.id) : deleteScenarioRow(confirmDelete.id, confirmDelete.linkedChatId)}
                        className="p-1 text-[#D63B1F] hover:opacity-70">
                        <i className="fas fa-check text-[11px]" />
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} title="Cancel"
                        className="p-1 text-[#9B9890] hover:text-[#5C5A55]">
                        <i className="fas fa-xmark text-[11px]" />
                      </button>
                    </div>
                  )
                }
                return (
                  <div key={row.key}
                    onClick={() => isDraft
                      ? openChat(row.chat.id)
                      : openForm(row.scenario.id, row.scenario.name, row.chat?.id || null)}
                    className={`group flex items-center gap-2 px-4 py-2 cursor-pointer ${current ? 'bg-[#F7F6F3]' : 'hover:bg-[#FBFAF8]'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isDraft ? 'bg-[#D4D1C9]' : row.scenario.is_active ? 'bg-[#1F8C4A]' : 'bg-[#C9C6BE]'
                    }`} title={isDraft ? 'Draft' : row.scenario.is_active ? 'Active' : 'Inactive'} />
                    <span className={`flex-1 min-w-0 truncate text-[13px] ${current ? 'font-semibold text-[#131210]' : 'text-[#5C5A55]'}`}>
                      {isDraft ? `Draft — ${row.chat.title || 'Untitled'}` : row.scenario.name}
                    </span>
                    {/* "…" menu */}
                    <div className="relative shrink-0">
                      <button type="button" title="More"
                        onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === row.key ? null : row.key) }}
                        className={`p-1 text-[#9B9890] hover:text-[#131210] transition-opacity ${menuOpenId === row.key ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <i className="fas fa-ellipsis text-[12px]" />
                      </button>
                      {menuOpenId === row.key && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setMenuOpenId(null) }} />
                          <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-[#E3E1DB] rounded-lg shadow-lg z-50 py-1"
                            onClick={e => e.stopPropagation()}>
                            {!isDraft && (
                              <>
                                <button type="button" onClick={() => toggleActive(row.scenario)}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-[#5C5A55] hover:bg-[#F7F6F3]">
                                  <i className={`fas ${row.scenario.is_active ? 'fa-pause' : 'fa-play'} w-4 text-center text-xs`} />
                                  {row.scenario.is_active ? 'Pause' : 'Resume'}
                                </button>
                                <button type="button"
                                  onClick={() => { setMenuOpenId(null); router.push(`/scenarios/${row.scenario.id}/edit`) }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-[#5C5A55] hover:bg-[#F7F6F3]">
                                  <i className="fas fa-pencil w-4 text-center text-xs" />Edit
                                </button>
                                <button type="button"
                                  onClick={() => { setMenuOpenId(null); setConfirmDelete({ kind: 'scenario', id: row.scenario.id, linkedChatId: row.chat?.id || null }) }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-[#D63B1F] hover:bg-[rgba(214,59,31,0.06)]">
                                  <i className="fas fa-trash w-4 text-center text-xs" />Delete
                                </button>
                              </>
                            )}
                            {isDraft && (
                              <button type="button"
                                onClick={() => { setMenuOpenId(null); setConfirmDelete({ kind: 'chat', id: row.chat.id }) }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-[#D63B1F] hover:bg-[rgba(214,59,31,0.06)]">
                                <i className="fas fa-trash w-4 text-center text-xs" />Delete chat
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        </aside>
      )}

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        {mode === 'builder' ? (
          <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E3E1DB] bg-white shrink-0">
            <span className="w-7 h-7 rounded-lg bg-[#D63B1F] flex items-center justify-center shrink-0">
              <i className="fas fa-wand-magic-sparkles text-white text-xs" />
            </span>
            <p className="text-base font-semibold text-[#131210] truncate flex-1 min-w-0">
              {chatScenarioId ? (name || 'Scenario') : 'New scenario'}
            </p>
            {chatScenarioId && (
              <>
                <button type="button"
                  onClick={() => openForm(chatScenarioId, name || '', chatId)}
                  className="px-3 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] shrink-0">
                  <i className="fas fa-sliders mr-1.5 text-[10px]" />Form
                </button>
                <button type="button"
                  onClick={() => testScenario?.id === chatScenarioId ? setMode('test') : openTest(chatScenarioId, name || '')}
                  className="px-3 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] shrink-0">
                  <i className="fas fa-vial mr-1.5 text-[10px]" />Test
                </button>
              </>
            )}
            <button onClick={onSwitchToManual}
              className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3]">
              <i className="fas fa-sliders mr-1.5 text-xs" />Set up manually
            </button>
          </div>
        ) : mode === 'form' ? null : (
          <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[#E3E1DB] bg-white shrink-0">
            <p className="text-base font-semibold text-[#D63B1F] shrink-0">Test</p>
            <p className="text-sm text-[#5C5A55] truncate flex-1 min-w-0">{testScenario?.name || '…'}</p>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-[rgba(31,140,74,0.08)] text-[#1F8C4A] border border-[rgba(31,140,74,0.18)]">
              <i className="fas fa-shield-alt text-[10px]" /> Practice mode — no real texts are sent
            </span>
            {chatId && thread.length > 0 && chatScenarioId === testScenario?.id && (
              <button type="button" onClick={() => { setCreatedNote(false); setMode('builder') }}
                className="px-3 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] shrink-0">
                <i className="fas fa-comments mr-1.5 text-[10px]" />View chat
              </button>
            )}
            {formScenario && formScenario.id === testScenario?.id && (
              <button type="button" onClick={() => setMode('form')}
                className="px-3 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] shrink-0">
                <i className="fas fa-sliders mr-1.5 text-[10px]" />Form
              </button>
            )}
            <button type="button" onClick={newTestChat}
              className="px-3 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] shrink-0">
              + New test chat
            </button>
          </div>
        )}

        {error && (
          <div className="px-5 py-2 text-xs bg-[rgba(214,59,31,0.07)] border-b border-[rgba(214,59,31,0.16)] text-[#D63B1F] shrink-0">{error}</div>
        )}

        {mode === 'builder' ? builderView : mode === 'form' ? formView : testView}
      </div>
    </div>
  )
}
