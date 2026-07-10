'use client'

// "Test your AI" — full-page sandbox chat for a scenario. The user plays the
// LEAD; the AI answers with the exact same prompt pipeline as a real inbound
// text. Nothing is sent to a phone, no credits are used. Test chats persist
// so prompt tweaks can be re-tested against the same conversation ideas.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { fetchWithWorkspace } from '@/lib/api-client'

export default function ScenarioSandboxPage() {
  const { id: scenarioId } = useParams()
  const router = useRouter()

  const [scenarioName, setScenarioName] = useState('')
  const [sessions, setSessions] = useState(null)         // null = loading
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [openerDraft, setOpenerDraft] = useState('')
  const [showOpener, setShowOpener] = useState(false)
  const [addingOpener, setAddingOpener] = useState(false)
  const bottomRef = useRef(null)

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetchWithWorkspace(`/api/scenarios/${scenarioId}/sandbox`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setScenarioName(data.scenario?.name || '')
      setSessions(data.sessions || [])
      return data.sessions || []
    } catch (e) {
      setError(e.message)
      setSessions([])
      return []
    }
  }, [scenarioId])

  // Initial load — open the most recent test chat, or start fresh with none.
  useEffect(() => {
    loadSessions().then(list => { if (list.length > 0) setActiveId(list[0].id) })
  }, [loadSessions])

  // Load the transcript when switching chats.
  useEffect(() => {
    if (!activeId) { setMessages([]); return }
    setLoadingMessages(true)
    fetchWithWorkspace(`/api/scenarios/${scenarioId}/sandbox/${activeId}/messages`)
      .then(r => r.json())
      .then(d => setMessages(d.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMessages(false))
  }, [scenarioId, activeId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const newChat = async () => {
    setError('')
    try {
      const res = await fetchWithWorkspace(`/api/scenarios/${scenarioId}/sandbox`, { method: 'POST', body: JSON.stringify({}) })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create test chat')
      await loadSessions()
      setActiveId(data.session.id)
    } catch (e) { setError(e.message) }
  }

  const deleteChat = async (sessionId) => {
    try {
      await fetchWithWorkspace(`/api/scenarios/${scenarioId}/sandbox?session_id=${sessionId}`, { method: 'DELETE' })
      const list = await loadSessions()
      if (activeId === sessionId) setActiveId(list[0]?.id || null)
    } finally { setConfirmDelete(null) }
  }

  // Insert the campaign/automation opening text as the first outbound bubble
  // (no AI reply — in real life the AI only speaks once the lead responds).
  const addOpener = async () => {
    const text = openerDraft.trim()
    if (!text || addingOpener) return
    setError('')
    setAddingOpener(true)

    let sessionId = activeId
    try {
      if (!sessionId) {
        const res = await fetchWithWorkspace(`/api/scenarios/${scenarioId}/sandbox`, { method: 'POST', body: JSON.stringify({}) })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create test chat')
        sessionId = data.session.id
        setActiveId(sessionId)
      }
      const res = await fetchWithWorkspace(`/api/scenarios/${scenarioId}/sandbox/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text, opener: true }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to add opening text')
      setMessages(prev => [...prev, data.opener])
      setOpenerDraft('')
      setShowOpener(false)
      loadSessions()
    } catch (e) {
      setError(e.message)
    } finally {
      setAddingOpener(false)
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setError('')

    // First message with no chat yet → create one on the fly.
    let sessionId = activeId
    if (!sessionId) {
      try {
        const res = await fetchWithWorkspace(`/api/scenarios/${scenarioId}/sandbox`, { method: 'POST', body: JSON.stringify({}) })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create test chat')
        sessionId = data.session.id
        setActiveId(sessionId)
        loadSessions()
      } catch (e) { setError(e.message); return }
    }

    setInput('')
    setSending(true)
    // Optimistic bubble for the tester's message.
    const tempId = `temp-${Math.random()}`
    setMessages(prev => [...prev, { id: tempId, direction: 'inbound', body: text, created_at: new Date().toISOString() }])

    try {
      const res = await fetchWithWorkspace(`/api/scenarios/${scenarioId}/sandbox/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'The AI could not reply. Try again.')
      setMessages(prev => [
        ...prev.filter(m => m.id !== tempId),
        data.message,
        ...(data.reply ? [data.reply] : []),
      ])
      loadSessions()   // refresh previews/order in the left panel
    } catch (e) {
      setError(e.message)
      setMessages(prev => prev.filter(m => m.id !== tempId))
      setInput(text)   // give the text back so it isn't lost
    } finally {
      setSending(false)
    }
  }

  const fmtTime = (iso) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E3E1DB] bg-white shrink-0">
        <button onClick={() => router.push(`/scenarios/${scenarioId}/edit`)} title="Back to scenario" className="p-2 -ml-1 rounded-lg text-[#5C5A55] hover:bg-[#F7F6F3]">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[#D63B1F] flex items-center justify-center shrink-0"><i className="fas fa-vial text-white text-xs" /></span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-[#131210] truncate leading-tight">Test your AI</p>
            <p className="text-[11px] text-[#9B9890] truncate leading-tight">{scenarioName || 'Scenario'}</p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-[rgba(31,140,74,0.08)] text-[#1F8C4A] border border-[rgba(31,140,74,0.18)]">
          <i className="fas fa-shield-alt text-[10px]" /> Practice mode — no real texts are sent
        </span>
        <button onClick={newChat} className="px-4 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg">
          + New test chat
        </button>
      </div>

      {error && (
        <div className="px-5 py-2 text-xs bg-[rgba(214,59,31,0.07)] border-b border-[rgba(214,59,31,0.16)] text-[#D63B1F] shrink-0">{error}</div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left — saved test chats */}
        <aside className="hidden md:flex flex-col w-64 shrink-0 bg-white border-r border-[#E3E1DB]">
          <p className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-widest text-[#9B9890]">Test chats</p>
          <div className="flex-1 overflow-y-auto pb-4">
            {sessions === null ? (
              <p className="px-4 text-xs text-[#9B9890]">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="px-4 text-xs text-[#9B9890] leading-relaxed">No test chats yet. Send a message to start one — each chat is saved so you can retry it after changing your prompt.</p>
            ) : sessions.map(s => (
              <div key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`group flex items-start gap-2 px-4 py-2.5 cursor-pointer border-b border-[#F7F6F3] ${activeId === s.id ? 'bg-[#F7F6F3]' : 'hover:bg-[#FBFAF8]'}`}>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] leading-tight truncate ${activeId === s.id ? 'font-semibold text-[#131210]' : 'text-[#5C5A55]'}`}>{s.name}</p>
                  <p className="text-[11px] text-[#9B9890] truncate mt-0.5">
                    {s.lastMessage ? (s.lastMessage.body || 'AI stopped replying') : 'Empty chat'}
                  </p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(s) }}
                  title="Delete test chat"
                  className="opacity-0 group-hover:opacity-100 p-1 text-[#9B9890] hover:text-[#D63B1F] transition-opacity">
                  <i className="fas fa-trash text-[11px]" />
                </button>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-[#E3E1DB]">
            <p className="text-[11px] text-[#9B9890] leading-relaxed">
              Replies use the <span className="font-medium text-[#5C5A55]">last saved version</span> of this scenario. Edit the prompt, save, then continue any chat to compare.
            </p>
          </div>
        </aside>

        {/* Main — chat window */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
            <div className="max-w-2xl mx-auto space-y-3">
              {loadingMessages ? (
                <p className="text-center text-xs text-[#9B9890] py-10">Loading chat…</p>
              ) : messages.length === 0 && !sending ? (
                <div className="text-center py-12">
                  <div className="w-12 h-12 rounded-2xl bg-[#EFEDE8] flex items-center justify-center mx-auto mb-3">
                    <i className="fas fa-comments text-[#9B9890]" />
                  </div>
                  <p className="text-sm font-medium text-[#131210]">Pretend you&rsquo;re the customer</p>
                  <p className="text-xs text-[#9B9890] mt-1 max-w-sm mx-auto leading-relaxed">
                    Type a message a real lead might send — &ldquo;Who is this?&rdquo;, &ldquo;How much does it cost?&rdquo;, &ldquo;Call me tomorrow&rdquo; — and see exactly how your AI would reply.
                  </p>

                  {/* Opening-text: real conversations usually start with OUR
                      campaign/automation template, then the lead replies. */}
                  {!showOpener ? (
                    <button onClick={() => setShowOpener(true)}
                      className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-[#D63B1F] border border-[#D63B1F]/40 rounded-lg px-3 py-2 hover:bg-[rgba(214,59,31,0.06)]">
                      <i className="fas fa-paper-plane text-[10px]" /> Start with the first text you send (campaign / automation)
                    </button>
                  ) : (
                    <div className="mt-5 max-w-md mx-auto text-left bg-white border border-[#E3E1DB] rounded-xl p-3">
                      <p className="text-xs font-semibold text-[#131210]">Your opening text</p>
                      <p className="text-[11px] text-[#9B9890] mt-0.5 mb-2 leading-relaxed">
                        Paste the first message your campaign or automation sends. Placeholders like {'{{first_name}}'} are filled with the sample lead (John Doe). The AI replies only after you answer as the lead.
                      </p>
                      <textarea value={openerDraft} onChange={e => setOpenerDraft(e.target.value)}
                        placeholder="Hi {{first_name}}, this is Sam with Acme Homes — are you still looking to sell your property in {{city}}?"
                        rows={3}
                        className="w-full px-3 py-2 border border-[#D4D1C9] rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]" />
                      <div className="flex justify-end gap-2 mt-2">
                        <button onClick={() => { setShowOpener(false); setOpenerDraft('') }}
                          className="px-3 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
                        <button onClick={addOpener} disabled={addingOpener || !openerDraft.trim()}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
                          {addingOpener ? 'Adding…' : 'Add opening text'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                messages.map(m => {
                  const isLead = m.direction === 'inbound'
                  const stopped = m.meta?.stopped
                  const humanNeeded = m.meta?.human_needed
                  const unresolvedTokens = m.meta?.unresolved_tokens || []
                  if (!isLead && stopped) {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <span className="text-[11px] px-3 py-1.5 rounded-full bg-[#EFEDE8] text-[#5C5A55]">
                          <i className="fas fa-hand mr-1.5 text-[10px]" />The AI chose to stop replying here (a real lead would get no response)
                        </span>
                      </div>
                    )
                  }
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
                      {!isLead && humanNeeded && (
                        <div className="flex justify-center mt-2">
                          <span className="text-[11px] px-3 py-1.5 rounded-full bg-[rgba(214,59,31,0.07)] text-[#D63B1F] border border-[rgba(214,59,31,0.16)]">
                            <i className="fas fa-user mr-1.5 text-[10px]" />The AI asked for a human here — the chat would be labeled &ldquo;Need human&rdquo; and the AI would stop
                          </span>
                        </div>
                      )}
                      {!isLead && unresolvedTokens.length > 0 && (
                        <div className="flex justify-center mt-2">
                          <span className="text-[11px] px-3 py-1.5 rounded-full bg-[rgba(214,59,31,0.07)] text-[#D63B1F] border border-[rgba(214,59,31,0.16)]">
                            <i className="fas fa-triangle-exclamation mr-1.5 text-[10px]" />
                            {m.meta?.opener
                              ? <>{unresolvedTokens.map(t => `{{${t}}}`).join(', ')} left blank here — in a real send {unresolvedTokens.length === 1 ? 'it comes' : 'they come'} from your campaign&rsquo;s contact data</>
                              : <>Heads up: {unresolvedTokens.map(t => `{{${t}}}`).join(', ')} {unresolvedTokens.length === 1 ? 'is' : 'are'} blank in tests — real leads need this field on their contact</>}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-white border border-[#E3E1DB] px-4 py-3 rounded-2xl rounded-bl-md">
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#9B9890] animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#9B9890] animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#9B9890] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-[#E3E1DB] bg-white px-4 md:px-8 py-3 shrink-0">
            <div className="max-w-2xl mx-auto flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Type a message as the lead…"
                rows={1}
                className="flex-1 px-3.5 py-2.5 border border-[#D4D1C9] rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]"
              />
              <button onClick={send} disabled={sending || !input.trim()}
                className="px-4 py-2.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-xl disabled:opacity-50 shrink-0">
                <i className="fas fa-paper-plane" />
              </button>
            </div>
            <p className="max-w-2xl mx-auto text-[10px] text-[#9B9890] mt-1.5">Enter to send · Shift+Enter for a new line · sample lead &ldquo;John Doe&rdquo; fills your {'{{placeholders}}'}</p>
          </div>
        </div>
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">Delete this test chat?</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[#5C5A55]">&ldquo;{confirmDelete.name}&rdquo; and its messages will be removed. This has no effect on real conversations.</p>
            </div>
            <div className="px-5 py-3 border-t border-[#E3E1DB] flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">Cancel</button>
              <button onClick={() => deleteChat(confirmDelete.id)} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
