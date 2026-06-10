'use client'

import { useState, useEffect } from 'react'
import { fetchWithWorkspace } from '@/lib/api-client'
import SearchableDropdown from '@/components/SearchableDropdown'

// ── shared bits (kept local so the builder is a self-contained page) ────────
const phoneOf = (p) => p?.phone_number || p?.phoneNumber || ''
const nameOf = (p) => p?.custom_name || p?.prefix || ''

const TRIGGER_LABELS = {
  create_item: 'New item created',
  change_column_value: 'A column value changes',
  move_item_to_group: 'Item moved to a group',
}

const inputCls = 'w-full px-3 py-2.5 border border-[#D4D1C9] rounded-lg text-sm bg-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]'
const labelCls = 'block text-sm font-medium text-[#5C5A55] mb-1.5'

const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86400 }
function delayToSeconds(amount, unit) {
  const n = Math.max(0, Math.floor(Number(amount) || 0))
  return n * (UNIT_SECONDS[unit] || 60)
}
function secondsToAmountUnit(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0))
  if (n === 0) return { amount: 0, unit: 'minutes' }
  if (n % UNIT_SECONDS.days === 0)  return { amount: n / UNIT_SECONDS.days,  unit: 'days' }
  if (n % UNIT_SECONDS.hours === 0) return { amount: n / UNIT_SECONDS.hours, unit: 'hours' }
  return { amount: Math.floor(n / UNIT_SECONDS.minutes), unit: 'minutes' }
}

function MondayLogo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="6" cy="16" r="5" fill="#FF3D57" />
      <circle cx="16" cy="16" r="5" fill="#FFCB00" />
      <circle cx="26" cy="16" r="5" fill="#00CA72" />
    </svg>
  )
}

// A node card in the horizontal flow.
function FlowCard({ badge, badgeBg, title, subtitle, accent = '#D63B1F', width = 'w-[340px]', children }) {
  return (
    <div className={`${width} shrink-0 bg-white rounded-xl border border-[#E3E1DB] shadow-sm`}>
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-t-xl border-b border-[#EFEDE8]" style={{ background: `${accent}0D` }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
          style={{ background: badgeBg || accent, borderColor: badgeBg ? '#E3E1DB' : 'transparent' }}>
          {badge}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#131210] leading-tight truncate">{title}</p>
          {subtitle && <p className="text-[11px] text-[#9B9890] leading-tight truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  )
}

// Curved, right-pointing connector between two cards. Grows (flex-1) so the
// cards spread evenly; a gentle S-curve drawn with a stroke that stays crisp at
// any width (non-scaling-stroke), with an undistorted arrowhead at the end.
function FlowArrowH() {
  return (
    <div className="flex-1 min-w-[44px] px-1.5 self-center flex items-center" aria-hidden>
      <svg className="flex-1 h-8" viewBox="0 0 100 32" preserveAspectRatio="none" fill="none">
        <path d="M0 16 C 30 16, 30 5, 50 5 C 70 5, 70 16, 100 16"
          stroke="#D63B1F" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <svg width="9" height="12" viewBox="0 0 9 12" className="-ml-px shrink-0">
        <path d="M9 6L0 0v12z" fill="#D63B1F" />
      </svg>
    </div>
  )
}

// Per-event column writeback editor — mirrors the Two-way Monday sync UI on the
// automations list page (status / date / text columns).
function EventEditor({ title, hint, columns, colId, setColId, valueLabel, setValueLabel, valueText, setValueText }) {
  const colObj = columns.find(c => c.id === colId)
  let statusLabels = []
  if (colObj?.type === 'status') {
    try {
      const settings = JSON.parse(colObj.settings_str || '{}')
      statusLabels = Object.values(settings.labels || {}).filter(Boolean)
    } catch { /* leave empty */ }
  }
  return (
    <div>
      <p className="text-xs font-semibold text-[#131210] uppercase tracking-wider">{title}</p>
      <p className="text-[11px] text-[#9B9890] mt-0.5 mb-2">{hint}</p>
      {/* Reads as a sentence: "Change [column] to [value]". */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-[#5C5A55]">
        <span className="font-medium text-[#131210]">Change</span>
        <div className="flex-1 min-w-[150px]">
          <select value={colId} onChange={(e) => { setColId(e.target.value); setValueLabel(''); setValueText('') }} className={inputCls}>
            <option value="">— No column (do nothing) —</option>
            {columns.map(c => <option key={c.id} value={c.id}>{c.title} ({c.type})</option>)}
          </select>
        </div>
        {colObj && <span className="font-medium text-[#131210]">to</span>}
        {colObj?.type === 'status' && (
          <div className="flex-1 min-w-[150px]">
            <select value={valueLabel} onChange={(e) => setValueLabel(e.target.value)} className={inputCls}>
              <option value="">— Choose a label —</option>
              {statusLabels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}
        {colObj?.type === 'date' && (
          <span className="flex-1 min-w-[120px] inline-flex items-center px-3 py-2.5 border border-[#E3E1DB] rounded-lg bg-[#F7F6F3] text-xs text-[#5C5A55]">today’s date</span>
        )}
        {colObj?.type === 'text' && (
          <input type="text" value={valueText} onChange={(e) => setValueText(e.target.value)} placeholder="text to write" className={`${inputCls} flex-1 min-w-[150px]`} />
        )}
      </div>
    </div>
  )
}

export default function AutomationBuilder({ phoneNumbers = [], automation = null, onSaved, onCancel }) {
  const isEdit = !!automation

  const initialForm = (() => {
    if (!automation) {
      return {
        name: '', boardId: '', boardName: '', triggerEvent: 'create_item',
        phoneColumnId: '', messageMode: 'template', messageTemplate: '',
        aiInstructions: '', senderPhoneNumberId: '',
        delayAmount: 0, delayUnit: 'minutes', businessHoursMode: 'anytime',
      }
    }
    const { amount, unit } = secondsToAmountUnit(automation.send_delay_seconds)
    return {
      name: automation.name || '',
      boardId: String(automation.board_id || ''),
      boardName: automation.board_name || '',
      triggerEvent: automation.trigger_event || 'create_item',
      phoneColumnId: automation.phone_column_id || '',
      messageMode: automation.message_mode || 'template',
      messageTemplate: automation.message_template || '',
      aiInstructions: automation.ai_instructions || '',
      senderPhoneNumberId: String(automation.sender_phone_number_id || ''),
      delayAmount: amount,
      delayUnit: unit,
      businessHoursMode: automation.business_hours_mode || (automation.respect_business_hours ? 'within' : 'anytime'),
    }
  })()

  const [form, setForm] = useState(initialForm)
  const [boards, setBoards] = useState([])
  const [columns, setColumns] = useState([])
  const [loadingBoards, setLoadingBoards] = useState(!isEdit)
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Two-way Monday sync (writeback) — per-board, mirrors the list-page feature.
  const [wbReplyCol, setWbReplyCol] = useState('')
  const [wbReplyLabel, setWbReplyLabel] = useState('')
  const [wbReplyText, setWbReplyText] = useState('')
  const [wbDoneCol, setWbDoneCol] = useState('')
  const [wbDoneLabel, setWbDoneLabel] = useState('')
  const [wbDoneText, setWbDoneText] = useState('')
  // Columns we can write back to (status / date / text only).
  const wbColumns = columns.filter(c => c.type === 'status' || c.type === 'date' || c.type === 'text')

  useEffect(() => {
    if (isEdit) return
    fetchWithWorkspace('/api/integrations/monday/boards')
      .then(r => r.json())
      .then(d => setBoards(d?.boards || []))
      .catch(() => setBoards([]))
      .finally(() => setLoadingBoards(false))
  }, [isEdit])

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
        if (phoneCol) setForm(f => f.phoneColumnId ? f : ({ ...f, phoneColumnId: phoneCol.id }))
      })
      .catch(() => setColumns([]))
      .finally(() => setLoadingColumns(false))
  }, [form.boardId])

  // Prefill the two-way sync card from any existing writeback config for the board.
  useEffect(() => {
    if (!form.boardId) return
    fetchWithWorkspace('/api/automations/writeback')
      .then(r => r.json())
      .then(d => {
        const cfg = (d?.configs || []).find(c => String(c.board_id) === String(form.boardId))
        if (!cfg) return
        setWbReplyCol(cfg.on_reply_column_id || '')
        setWbReplyLabel(cfg.on_reply_value?.label || '')
        setWbReplyText(cfg.on_reply_value?.text || '')
        setWbDoneCol(cfg.on_done_column_id || '')
        setWbDoneLabel(cfg.on_done_value?.label || '')
        setWbDoneText(cfg.on_done_value?.text || '')
      })
      .catch(() => {})
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
      const url = isEdit ? `/api/automations/${automation.id}` : '/api/automations'
      const method = isEdit ? 'PATCH' : 'POST'
      const payload = isEdit
        ? {
            name: form.name,
            phone_column_id: form.phoneColumnId,
            message_mode: form.messageMode,
            message_template: form.messageTemplate,
            ai_instructions: form.aiInstructions,
            sender_phone_number_id: form.senderPhoneNumberId,
            send_delay_seconds: delayToSeconds(form.delayAmount, form.delayUnit),
            business_hours_mode: form.businessHoursMode,
          }
        : {
            name: form.name,
            board_id: form.boardId,
            board_name: form.boardName,
            trigger_event: form.triggerEvent,
            phone_column_id: form.phoneColumnId,
            message_mode: form.messageMode,
            message_template: form.messageTemplate,
            ai_instructions: form.aiInstructions,
            sender_phone_number_id: form.senderPhoneNumberId,
            send_delay_seconds: delayToSeconds(form.delayAmount, form.delayUnit),
            business_hours_mode: form.businessHoursMode,
          }

      const res = await fetchWithWorkspace(url, { method, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok || !data.success) { setError(data.error || (isEdit ? 'Failed to save changes' : 'Failed to create automation')); return }

      // Persist the two-way sync rules for this board (best-effort — never blocks
      // the automation from being created). Only upsert when something changed —
      // either a rule is set now, or we're editing (so clears are saved too).
      const wbPayload = (colId, label, text) => {
        const col = wbColumns.find(c => c.id === colId)
        if (!colId || !col) return { columnId: null, columnType: null, value: null }
        if (col.type === 'status') return { columnId: colId, columnType: 'status', value: { label } }
        if (col.type === 'date')   return { columnId: colId, columnType: 'date',   value: null }
        if (col.type === 'text')   return { columnId: colId, columnType: 'text',   value: { text } }
        return { columnId: null, columnType: null, value: null }
      }
      if (form.boardId && (isEdit || wbReplyCol || wbDoneCol)) {
        const reply = wbPayload(wbReplyCol, wbReplyLabel, wbReplyText)
        const done = wbPayload(wbDoneCol, wbDoneLabel, wbDoneText)
        await fetchWithWorkspace('/api/automations/writeback', {
          method: 'POST',
          body: JSON.stringify({
            board_id: form.boardId,
            board_name: form.boardName || automation?.board_name,
            on_reply_column_id: reply.columnId, on_reply_column_type: reply.columnType, on_reply_value: reply.value,
            on_done_column_id: done.columnId, on_done_column_type: done.columnType, on_done_value: done.value,
          }),
        }).catch(() => {})
      }

      onSaved?.(data.automation)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]">
      {/* Top bar — back, editable name title, actions */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E3E1DB] bg-white shrink-0">
        <button onClick={onCancel} title="Back" className="p-2 -ml-1 rounded-lg text-[#5C5A55] hover:bg-[#F7F6F3]">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[#D63B1F] flex items-center justify-center shrink-0">
            <i className="fas fa-bolt text-white text-xs" />
          </span>
          <input
            className="flex-1 min-w-0 text-base font-semibold text-[#131210] placeholder-[#B5B2AA] bg-transparent focus:outline-none"
            value={form.name}
            placeholder={isEdit ? 'Automation name' : 'Untitled automation'}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <button onClick={onCancel} className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3]">Cancel</button>
        <button onClick={submit} disabled={submitting}
          className="px-5 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-50">
          {submitting ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save changes' : 'Create Automation')}
        </button>
      </div>

      {error && (
        <div className="px-5 py-2 text-xs bg-[rgba(214,59,31,0.07)] border-b border-[rgba(214,59,31,0.16)] text-[#D63B1F] shrink-0">
          {error}
        </div>
      )}

      {/* Canvas — horizontal flow */}
      <div className="flex-1 overflow-auto" style={{ background: '#FAF9F6', backgroundImage: 'radial-gradient(#E0DED7 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        <div className="flex items-start w-full p-10" style={{ minWidth: 'max-content' }}>

          {/* 1 ── Trigger (Monday) */}
          <FlowCard accent="#6161FF" badgeBg="#FFFFFF" badge={<MondayLogo size={16} />} title="When this happens" subtitle="Trigger — Monday board">
            <div>
              <label className={labelCls}>Monday board *</label>
              {isEdit ? (
                <div className="px-3 py-2.5 border border-[#E3E1DB] rounded-lg text-sm bg-[#F7F6F3] text-[#5C5A55]">{form.boardName || form.boardId}</div>
              ) : (
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
              )}
            </div>
            <div>
              <label className={labelCls}>Trigger</label>
              {isEdit ? (
                <div className="px-3 py-2.5 border border-[#E3E1DB] rounded-lg text-sm bg-[#F7F6F3] text-[#5C5A55]">{TRIGGER_LABELS[form.triggerEvent] || form.triggerEvent}</div>
              ) : (
                <select className={inputCls} value={form.triggerEvent}
                  onChange={e => setForm(f => ({ ...f, triggerEvent: e.target.value }))}>
                  {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
            </div>
            {isEdit && (
              <p className="text-[11px] text-[#9B9890]">Board and trigger are locked because the Monday webhook is bound to them. To change either, delete this automation and create a new one.</p>
            )}
            <div>
              <label className={labelCls}>Phone number column *</label>
              {form.boardId ? (
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
              ) : (
                <div className="px-3 py-2.5 border border-dashed border-[#D4D1C9] rounded-lg text-sm bg-[#F7F6F3] text-[#9B9890]">Pick a board first</div>
              )}
            </div>
          </FlowCard>

          <FlowArrowH />

          {/* 2 ── Send SMS */}
          <FlowCard accent="#D63B1F" width="w-[460px]" badge={<i className="fas fa-comment-dots text-white text-xs" />} title="Send a text" subtitle="SMS to the new lead">
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
              <p className="text-[11px] text-[#9B9890] mt-1.5">Replies are handled by whichever AI scenario is assigned to this number.</p>
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
                  <p className="text-[11px] text-[#9B9890] mt-1.5">The AI writes a unique opening message per lead, using their board details.</p>
                </>
              )}
            </div>
          </FlowCard>

          <FlowArrowH />

          {/* 3 ── Timing */}
          <FlowCard accent="#2563EB" badge={<i className="fas fa-clock text-white text-xs" />} title="When to send" subtitle="Delay & business hours">
            <div>
              <label className={labelCls}>Send delay</label>
              <div className="flex gap-2">
                <input type="number" min={0} max={999} value={form.delayAmount}
                  onChange={(e) => setForm(f => ({ ...f, delayAmount: e.target.value }))}
                  className="w-24 shrink-0 px-3 py-2.5 border border-[#D4D1C9] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]" />
                <select value={form.delayUnit}
                  onChange={(e) => setForm(f => ({ ...f, delayUnit: e.target.value }))}
                  className="flex-1 min-w-0 px-3 py-2.5 border border-[#D4D1C9] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]">
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
              <p className="text-[11px] text-[#9B9890] mt-1">Set to <span className="font-mono">0</span> for immediate. Useful when the Monday form fills in columns a beat after item creation.</p>
            </div>
            <div>
              <label className={labelCls}>Business hours</label>
              <select value={form.businessHoursMode}
                onChange={(e) => setForm(f => ({ ...f, businessHoursMode: e.target.value }))}
                className="w-full px-3 py-2.5 border border-[#D4D1C9] rounded-lg bg-white text-sm text-[#131210]">
                <option value="anytime">Send any time</option>
                <option value="within">Only within business hours</option>
                <option value="outside">Only outside business hours</option>
              </select>
              <p className="text-[11px] text-[#9B9890] mt-1">
                {form.businessHoursMode === 'within'
                  ? 'Sends are held until the next time inside your business hours.'
                  : form.businessHoursMode === 'outside'
                  ? 'Sends are held until outside your business hours (before open / after close).'
                  : 'No time restriction — sends go out as soon as they’re due.'}
                {' '}Configure the schedule in <a href="/settings?section=business-hours" className="text-[#D63B1F] hover:underline">Settings → Business Hours</a>.
              </p>
            </div>
          </FlowCard>

          <FlowArrowH />

          {/* 4 ── Two-way Monday sync (writeback) */}
          <FlowCard accent="#16A34A" width="w-[380px]" badge={<i className="fas fa-rotate text-white text-xs" />} title="Sync back to Monday" subtitle="Two-way sync — optional">
            {form.boardId ? (
              <>
                <EventEditor
                  title="When a lead replies"
                  hint="Set on every inbound message — e.g. Status = Engaged, or Last contact = today."
                  columns={wbColumns}
                  colId={wbReplyCol} setColId={setWbReplyCol}
                  valueLabel={wbReplyLabel} setValueLabel={setWbReplyLabel}
                  valueText={wbReplyText} setValueText={setWbReplyText}
                />
                <div className="border-t border-[#EFEDE8] pt-3">
                  <EventEditor
                    title="When marked done"
                    hint="Set when you toggle the chat to Done / Closed."
                    columns={wbColumns}
                    colId={wbDoneCol} setColId={setWbDoneCol}
                    valueLabel={wbDoneLabel} setValueLabel={setWbDoneLabel}
                    valueText={wbDoneText} setValueText={setWbDoneText}
                  />
                </div>
              </>
            ) : (
              <div className="px-3 py-2.5 border border-dashed border-[#D4D1C9] rounded-lg text-sm bg-[#F7F6F3] text-[#9B9890]">Pick a board first</div>
            )}
          </FlowCard>

        </div>
      </div>
    </div>
  )
}
