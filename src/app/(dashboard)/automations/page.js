'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchWithWorkspace } from '@/lib/api-client'
import SearchableDropdown from '@/components/SearchableDropdown'

// Phone number rows come back with either snake_case or camelCase keys
// depending on the source — normalize here.
const phoneOf = (p) => p?.phone_number || p?.phoneNumber || ''
const nameOf = (p) => p?.custom_name || p?.prefix || ''

const TRIGGER_LABELS = {
  create_item: 'New item created',
  change_column_value: 'A column value changes',
  move_item_to_group: 'Item moved to a group',
}

function MondayLogo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="6" cy="16" r="5" fill="#FF3D57" />
      <circle cx="16" cy="16" r="5" fill="#FFCB00" />
      <circle cx="26" cy="16" r="5" fill="#00CA72" />
    </svg>
  )
}

const inputCls = 'w-full px-3 py-2.5 border border-[#D4D1C9] rounded-lg text-sm bg-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]'
const labelCls = 'block text-sm font-medium text-[#5C5A55] mb-1.5'

export default function AutomationsPage() {
  const [automations, setAutomations] = useState([])
  const [loading, setLoading] = useState(true)
  const [mondayConnected, setMondayConnected] = useState(null)
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [busyId, setBusyId] = useState(null)
  // Two-way sync — keyed by board_id
  const [writebackConfigs, setWritebackConfigs] = useState({})

  const load = useCallback(async () => {
    try {
      const [aRes, mRes, pRes, wRes] = await Promise.all([
        fetchWithWorkspace('/api/automations').then(r => r.json()),
        fetchWithWorkspace('/api/integrations/monday').then(r => r.json()),
        fetchWithWorkspace('/api/phone-numbers').then(r => r.json()),
        fetchWithWorkspace('/api/automations/writeback').then(r => r.json()),
      ])
      setAutomations(aRes?.automations || [])
      setMondayConnected(!!mRes?.connected)
      setPhoneNumbers(pRes?.phoneNumbers || [])
      const map = {}
      for (const c of (wRes?.configs || [])) map[c.board_id] = c
      setWritebackConfigs(map)
    } catch (e) {
      console.error('[automations] load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleActive = async (a) => {
    setBusyId(a.id)
    try {
      await fetchWithWorkspace(`/api/automations/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !a.is_active }),
      })
      setAutomations(prev => prev.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x))
    } finally { setBusyId(null) }
  }

  const remove = async (a) => {
    if (!confirm(`Delete automation "${a.name}"? The Monday webhook will be removed.`)) return
    setBusyId(a.id)
    try {
      const res = await fetchWithWorkspace(`/api/automations/${a.id}`, { method: 'DELETE' })
      if (res.ok) setAutomations(prev => prev.filter(x => x.id !== a.id))
    } finally { setBusyId(null) }
  }

  const phoneLabel = (id) => {
    const p = phoneNumbers.find(x => String(x.id) === String(id))
    if (!p) return '—'
    const num = phoneOf(p), nm = nameOf(p)
    return nm ? `${nm} (${num})` : num
  }

  return (
    <div className="h-full bg-[#F7F6F3] overflow-y-auto">
      <div className="px-6 py-8">

        <div className="flex items-center justify-between gap-4 mb-1">
          <h1 className="text-xl font-semibold text-[#131210]">Automations</h1>
          <button
            onClick={() => setShowCreate(true)}
            disabled={!mondayConnected}
            title={mondayConnected ? '' : 'Connect Monday.com first'}
            className="px-4 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            + New Automation
          </button>
        </div>
        <p className="text-sm text-[#9B9890] mb-6">
          Text new Monday leads automatically — the moment a board event fires.
        </p>

        {mondayConnected === false && (
          <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-lg bg-[rgba(214,59,31,0.06)] border border-[rgba(214,59,31,0.16)]">
            <MondayLogo size={20} />
            <p className="text-sm text-[#5C5A55]">
              Connect <a href="/settings?section=integrations" className="text-[#D63B1F] font-medium hover:underline">Monday.com</a> in
              Settings → Integrations before creating an automation.
            </p>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[#9B9890]">Loading…</p>
        ) : automations.length === 0 ? (
          <div className="border border-dashed border-[#D4D1C9] rounded-xl py-14 text-center">
            <div className="flex justify-center mb-3"><MondayLogo size={32} /></div>
            <p className="text-sm font-medium text-[#131210]">No automations yet</p>
            <p className="text-xs text-[#9B9890] mt-1">
              Create one to auto-text leads as they land on a Monday board.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {automations.map(a => (
              <div key={a.id} className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <MondayLogo size={18} />
                      <p className="text-sm font-semibold text-[#131210] truncate">{a.name}</p>
                      <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${a.is_active ? 'bg-[rgba(31,140,74,0.08)] text-[#1F8C4A]' : 'bg-[#EFEDE8] text-[#9B9890]'}`}>
                        {a.is_active ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <p className="text-xs text-[#9B9890] mt-1.5">
                      Board <span className="text-[#5C5A55]">{a.board_name || a.board_id}</span>
                      {' · '}{TRIGGER_LABELS[a.trigger_event] || a.trigger_event}
                      {' · '}{a.message_mode === 'ai' ? 'AI-written message' : 'Template message'}
                    </p>
                    <p className="text-xs text-[#9B9890] mt-0.5">
                      Sends from <span className="text-[#5C5A55]">{phoneLabel(a.sender_phone_number_id)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleActive(a)}
                      disabled={busyId === a.id}
                      className="px-2.5 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3] disabled:opacity-50 transition-colors"
                    >
                      {a.is_active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => remove(a)}
                      disabled={busyId === a.id}
                      title="Delete"
                      className="p-1.5 text-[#9B9890] hover:text-[#D63B1F] hover:bg-[#F7F6F3] rounded-md disabled:opacity-50 transition-colors"
                    >
                      <i className="fas fa-trash text-xs" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Two-way Monday sync ─────────────────────────────────────── */}
        {!loading && mondayConnected && automations.length > 0 && (
          <WritebackSection
            automations={automations}
            configs={writebackConfigs}
            onSaved={(config) => setWritebackConfigs(prev => ({ ...prev, [config.board_id]: config }))}
            onCleared={(boardId) => setWritebackConfigs(prev => {
              const next = { ...prev }; delete next[boardId]; return next
            })}
          />
        )}
      </div>

      {showCreate && (
        <CreateAutomationModal
          phoneNumbers={phoneNumbers}
          onClose={() => setShowCreate(false)}
          onCreated={(a) => { setAutomations(prev => [a, ...prev]); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

// ─── Two-way Monday sync ────────────────────────────────────────────────────
// One card per unique board (derived from automations). Each card shows the
// current writeback config and lets you edit it inline. Column choices come
// from /api/integrations/monday/boards/[id]/columns and are filtered to
// types we know how to write back (status, date, text).

function WritebackSection({ automations, configs, onSaved, onCleared }) {
  // Unique boards from automations.
  const boards = []
  const seen = new Set()
  for (const a of automations) {
    if (seen.has(a.board_id)) continue
    seen.add(a.board_id)
    boards.push({ id: a.board_id, name: a.board_name || a.board_id })
  }

  return (
    <div className="mt-10 pt-6 border-t border-[#E3E1DB]">
      <h2 className="text-base font-semibold text-[#131210]">Two-way Monday sync</h2>
      <p className="text-xs text-[#9B9890] mt-1 mb-4">
        When a lead replies or a conversation is marked done, automatically update a column on the source Monday item.
      </p>
      <div className="space-y-2">
        {boards.map(b => (
          <BoardWritebackCard
            key={b.id}
            board={b}
            config={configs[b.id] || null}
            onSaved={onSaved}
            onCleared={onCleared}
          />
        ))}
      </div>
    </div>
  )
}

function BoardWritebackCard({ board, config, onSaved, onCleared }) {
  const [open, setOpen] = useState(false)
  const [columns, setColumns] = useState(null)        // null = not loaded, [] = loaded empty
  const [loadingCols, setLoadingCols] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state — initialized from existing config or blank.
  const [replyCol, setReplyCol] = useState(config?.on_reply_column_id || '')
  const [replyValueLabel, setReplyValueLabel] = useState(config?.on_reply_value?.label || '')
  const [replyValueText, setReplyValueText] = useState(config?.on_reply_value?.text || '')
  const [doneCol, setDoneCol] = useState(config?.on_done_column_id || '')
  const [doneValueLabel, setDoneValueLabel] = useState(config?.on_done_value?.label || '')
  const [doneValueText, setDoneValueText] = useState(config?.on_done_value?.text || '')

  const expand = async () => {
    setOpen(o => !o)
    if (columns || loadingCols) return
    setLoadingCols(true)
    try {
      const res = await fetchWithWorkspace(`/api/integrations/monday/boards/${board.id}/columns`)
      const data = await res.json()
      // Keep only types we support for writeback.
      const ok = (data?.columns || []).filter(c => c.type === 'status' || c.type === 'date' || c.type === 'text')
      setColumns(ok)
    } catch (e) {
      console.error('[writeback] columns load failed:', e)
      setColumns([])
    } finally {
      setLoadingCols(false)
    }
  }

  const colById = new Map((columns || []).map(c => [c.id, c]))
  const replyColObj = colById.get(replyCol)
  const doneColObj  = colById.get(doneCol)

  // Build the per-event payload — null when nothing's configured for that event.
  function buildPayload(colId, colObj, valueLabel, valueText) {
    if (!colId || !colObj) return { columnId: null, columnType: null, value: null }
    if (colObj.type === 'status') return { columnId: colId, columnType: 'status', value: { label: valueLabel } }
    if (colObj.type === 'date')   return { columnId: colId, columnType: 'date',   value: null }   // always today
    if (colObj.type === 'text')   return { columnId: colId, columnType: 'text',   value: { text: valueText } }
    return { columnId: null, columnType: null, value: null }
  }

  const save = async () => {
    setSaving(true)
    try {
      const reply = buildPayload(replyCol, replyColObj, replyValueLabel, replyValueText)
      const done  = buildPayload(doneCol,  doneColObj,  doneValueLabel,  doneValueText)
      const res = await fetchWithWorkspace('/api/automations/writeback', {
        method: 'POST',
        body: JSON.stringify({
          board_id: board.id,
          board_name: board.name,
          on_reply_column_id: reply.columnId,
          on_reply_column_type: reply.columnType,
          on_reply_value: reply.value,
          on_done_column_id: done.columnId,
          on_done_column_type: done.columnType,
          on_done_value: done.value,
        }),
      })
      const data = await res.json()
      if (res.ok && data.config) {
        onSaved(data.config)
        setOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    if (!confirm(`Remove two-way sync for "${board.name}"?`)) return
    setSaving(true)
    try {
      const res = await fetchWithWorkspace(`/api/automations/writeback?board_id=${encodeURIComponent(board.id)}`, { method: 'DELETE' })
      if (res.ok) {
        onCleared(board.id)
        setReplyCol(''); setReplyValueLabel(''); setReplyValueText('')
        setDoneCol(''); setDoneValueLabel(''); setDoneValueText('')
        setOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  // Summary line shown when collapsed.
  const summary = (() => {
    if (!config) return 'Not configured'
    const parts = []
    if (config.on_reply_column_id) parts.push(`On reply → ${config.on_reply_column_id}`)
    if (config.on_done_column_id)  parts.push(`On done → ${config.on_done_column_id}`)
    return parts.join(' · ') || 'Not configured'
  })()

  return (
    <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl">
      <button
        onClick={expand}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#131210] truncate">{board.name}</p>
          <p className="text-xs text-[#9B9890] mt-0.5">{summary}</p>
        </div>
        <span className="text-xs text-[#9B9890]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-[#EFEDE8]">
          {loadingCols ? (
            <p className="text-xs text-[#9B9890] py-3">Loading columns…</p>
          ) : (
            <>
              <EventEditor
                title="When a lead replies"
                hint="Set on every inbound message — e.g. 'Last contact = today' or 'Status = Engaged'."
                columns={columns || []}
                colId={replyCol}        setColId={setReplyCol}
                valueLabel={replyValueLabel} setValueLabel={setReplyValueLabel}
                valueText={replyValueText}   setValueText={setReplyValueText}
              />
              <EventEditor
                title="When a conversation is marked done"
                hint="Set when you toggle the chat to Done/Closed."
                columns={columns || []}
                colId={doneCol}        setColId={setDoneCol}
                valueLabel={doneValueLabel} setValueLabel={setDoneValueLabel}
                valueText={doneValueText}   setValueText={setDoneValueText}
              />

              <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-[#EFEDE8]">
                {config ? (
                  <button onClick={clear} disabled={saving} className="text-xs text-[#9B9890] hover:text-[#D63B1F]">
                    Remove rules
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-[#F7F6F3]">
                    Cancel
                  </button>
                  <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-md disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save rules'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function EventEditor({ title, hint, columns, colId, setColId, valueLabel, setValueLabel, valueText, setValueText }) {
  const colObj = columns.find(c => c.id === colId)
  // Status columns expose `settings_str` (JSON) — parse for label options.
  let statusLabels = []
  if (colObj?.type === 'status') {
    try {
      const settings = JSON.parse(colObj.settings_str || '{}')
      const labels = settings.labels || {}
      statusLabels = Object.values(labels).filter(Boolean)
    } catch { /* leave empty */ }
  }

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-[#131210] uppercase tracking-wider">{title}</p>
      <p className="text-[11px] text-[#9B9890] mt-0.5 mb-2">{hint}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={colId}
          onChange={(e) => { setColId(e.target.value); setValueLabel(''); setValueText('') }}
          className={inputCls}
        >
          <option value="">— No update —</option>
          {columns.map(c => (
            <option key={c.id} value={c.id}>{c.title} ({c.type})</option>
          ))}
        </select>

        {colObj?.type === 'status' && (
          <select value={valueLabel} onChange={(e) => setValueLabel(e.target.value)} className={inputCls}>
            <option value="">— Choose a label —</option>
            {statusLabels.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        {colObj?.type === 'date' && (
          <div className="flex items-center px-3 py-2.5 border border-[#E3E1DB] rounded-lg bg-[#F7F6F3] text-xs text-[#5C5A55]">
            Always set to today
          </div>
        )}
        {colObj?.type === 'text' && (
          <input
            type="text"
            value={valueText}
            onChange={(e) => setValueText(e.target.value)}
            placeholder="Text to write"
            className={inputCls}
          />
        )}
      </div>
    </div>
  )
}

function CreateAutomationModal({ phoneNumbers, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', boardId: '', boardName: '', triggerEvent: 'create_item',
    phoneColumnId: '', messageMode: 'template', messageTemplate: '',
    aiInstructions: '', senderPhoneNumberId: '',
  })
  const [boards, setBoards] = useState([])
  const [columns, setColumns] = useState([])
  const [loadingBoards, setLoadingBoards] = useState(true)
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchWithWorkspace('/api/integrations/monday/boards')
      .then(r => r.json())
      .then(d => setBoards(d?.boards || []))
      .catch(() => setBoards([]))
      .finally(() => setLoadingBoards(false))
  }, [])

  useEffect(() => {
    if (!form.boardId) { setColumns([]); return }
    setLoadingColumns(true)
    setColumns([])
    fetchWithWorkspace(`/api/integrations/monday/boards/${form.boardId}/columns`)
      .then(r => r.json())
      .then(d => {
        const cols = d?.columns || []
        setColumns(cols)
        const phoneCol = cols.find(c => c.isPhoneType)
        if (phoneCol) setForm(f => ({ ...f, phoneColumnId: phoneCol.id }))
      })
      .catch(() => setColumns([]))
      .finally(() => setLoadingColumns(false))
  }, [form.boardId])

  const submit = async () => {
    setError('')
    if (!form.name.trim()) return setError('Give the automation a name.')
    if (!form.boardId) return setError('Pick a board.')
    if (!form.phoneColumnId) return setError('Pick the phone-number column.')
    if (!form.senderPhoneNumberId) return setError('Pick a sender number.')
    if (form.messageMode === 'template' && !form.messageTemplate.trim()) return setError('Write a message template.')
    if (form.messageMode === 'ai' && !form.aiInstructions.trim()) return setError('Write the AI instructions.')

    setSubmitting(true)
    try {
      const res = await fetchWithWorkspace('/api/automations', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          board_id: form.boardId,
          board_name: form.boardName,
          trigger_event: form.triggerEvent,
          phone_column_id: form.phoneColumnId,
          message_mode: form.messageMode,
          message_template: form.messageTemplate,
          ai_instructions: form.aiInstructions,
          sender_phone_number_id: form.senderPhoneNumberId,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) { setError(data.error || 'Failed to create automation'); return }
      onCreated(data.automation)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E1DB]">
          <h3 className="text-base font-semibold text-[#131210]">New Automation</h3>
          <button onClick={onClose} className="text-[#9B9890] hover:text-[#5C5A55] p-1">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4">
          <div>
            <label className={labelCls}>Automation name *</label>
            <input className={inputCls} value={form.name} placeholder="e.g., Honest Offer weekend leads"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div>
            <label className={labelCls}>Monday board *</label>
            <SearchableDropdown
              value={form.boardId}
              onChange={(v) => {
                const b = boards.find(x => String(x.id) === String(v))
                setForm(f => ({ ...f, boardId: v, boardName: b?.name || '', phoneColumnId: '' }))
              }}
              options={boards.map(b => ({ value: String(b.id), label: b.name, searchText: b.name }))}
              placeholder={loadingBoards ? 'Loading boards…' : 'Select a board'}
              loading={loadingBoards}
              renderSelected={(o) => o.label}
              renderOption={(o) => <p className="text-sm text-[#131210]">{o.label}</p>}
            />
          </div>

          <div>
            <label className={labelCls}>Trigger</label>
            <select className={inputCls} value={form.triggerEvent}
              onChange={e => setForm(f => ({ ...f, triggerEvent: e.target.value }))}>
              {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {form.boardId && (
            <div>
              <label className={labelCls}>Phone number column *</label>
              <SearchableDropdown
                value={form.phoneColumnId}
                onChange={(v) => setForm(f => ({ ...f, phoneColumnId: v }))}
                options={columns.map(c => ({ value: c.id, label: c.title, type: c.type, searchText: `${c.title} ${c.type}` }))}
                placeholder={loadingColumns ? 'Loading columns…' : 'Select the phone column'}
                loading={loadingColumns}
                renderSelected={(o) => o.label}
                renderOption={(o) => (
                  <div>
                    <p className="text-sm text-[#131210]">{o.label}</p>
                    <p className="text-xs text-[#9B9890] font-mono mt-0.5">{o.type}</p>
                  </div>
                )}
              />
            </div>
          )}

          <div>
            <label className={labelCls}>Sender number *</label>
            <SearchableDropdown
              value={form.senderPhoneNumberId}
              onChange={(v) => setForm(f => ({ ...f, senderPhoneNumberId: v }))}
              options={phoneNumbers.map(p => {
                const num = phoneOf(p), nm = nameOf(p)
                return { value: String(p.id), name: nm, number: num, searchText: `${nm} ${num}` }
              })}
              placeholder="Select a number"
              renderSelected={(o) => o.name ? `${o.name} — ${o.number}` : o.number}
              renderOption={(o) => (
                <div>
                  {o.name && <p className="text-sm font-medium text-[#131210]">{o.name}</p>}
                  <p className={`text-sm ${o.name ? 'text-[#9B9890]' : 'text-[#131210]'}`}>{o.number}</p>
                </div>
              )}
            />
            <p className="text-[11px] text-[#9B9890] mt-1.5">
              Replies are handled by whichever AI scenario is assigned to this number.
            </p>
          </div>

          <div>
            <label className={labelCls}>Message</label>
            <div className="flex gap-2 mb-2">
              {[['template', 'Template'], ['ai', 'AI-written']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setForm(f => ({ ...f, messageMode: v }))}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-md border transition-colors ${form.messageMode === v ? 'bg-[#fdecea] border-[#D63B1F] text-[#D63B1F]' : 'bg-[#FFFFFF] border-[#E3E1DB] text-[#5C5A55] hover:bg-[#F7F6F3]'}`}>
                  {l}
                </button>
              ))}
            </div>
            {form.messageMode === 'template' ? (
              <>
                <textarea className={`${inputCls} resize-y min-h-[100px]`} value={form.messageTemplate}
                  placeholder="Hi {{name}}, thanks for your interest! …"
                  onChange={e => setForm(f => ({ ...f, messageTemplate: e.target.value }))} />
                {columns.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[11px] text-[#9B9890]">Placeholders:</span>
                    {[...new Set(['name', ...columns.map(c => c.placeholder).filter(Boolean)])].map(p => (
                      <button key={p} type="button"
                        onClick={() => setForm(f => ({ ...f, messageTemplate: f.messageTemplate + `{{${p}}}` }))}
                        className="px-2 py-0.5 text-[11px] font-mono bg-[#EFEDE8] text-[#5C5A55] rounded border border-[#E3E1DB] hover:text-[#D63B1F]">
                        {`{{${p}}}`}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <textarea className={`${inputCls} resize-y min-h-[100px]`} value={form.aiInstructions}
                  placeholder="Write a warm opening text introducing our home-buying offer and asking if they'd like a cash quote…"
                  onChange={e => setForm(f => ({ ...f, aiInstructions: e.target.value }))} />
                <p className="text-[11px] text-[#9B9890] mt-1.5">
                  The AI writes a unique opening message per lead, using their board details.
                </p>
              </>
            )}
          </div>

          {error && (
            <div className="px-3 py-2 rounded-md text-xs bg-[rgba(214,59,31,0.07)] border border-[rgba(214,59,31,0.16)] text-[#D63B1F]">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#E3E1DB]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3]">Cancel</button>
          <button onClick={submit} disabled={submitting}
            className="px-5 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-50">
            {submitting ? 'Creating…' : 'Create Automation'}
          </button>
        </div>
      </div>
    </div>
  )
}
