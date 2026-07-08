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

function SheetsLogo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M8 2h12l6 6v20a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2z" fill="#0F9D58" />
      <path d="M20 2l6 6h-6V2z" fill="#87CEAC" />
      <path d="M11 14h10v9H11v-9zm2 2v1.5h2.5V16H13zm4.5 0v1.5H20V16h-2.5zM13 19.5V21h2.5v-1.5H13zm4.5 0V21H20v-1.5h-2.5z" fill="#FFFFFF" />
    </svg>
  )
}

// Writeback editor for a sheet column — everything in a sheet is text, so this
// is just "Change [column] to [value]" with a free-text value.
function SheetEventEditor({ title, hint, columns, col, setCol, value, setValue }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[#131210] uppercase tracking-wider">{title}</p>
      <p className="text-[11px] text-[#9B9890] mt-0.5 mb-2">{hint}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-[#5C5A55]">
        <span className="font-medium text-[#131210]">Change</span>
        <div className="flex-1 min-w-[150px]">
          <select value={col} onChange={(e) => { setCol(e.target.value); setValue('') }} className={inputCls}>
            <option value="">— No column (do nothing) —</option>
            {columns.map(c => <option key={c.id} value={c.id}>{c.title} ({c.id})</option>)}
          </select>
        </div>
        {col && <span className="font-medium text-[#131210]">to</span>}
        {col && (
          <input type="text" value={value} onChange={(e) => setValue(e.target.value)}
            placeholder="text to write — {{date}} = today" className={`${inputCls} flex-1 min-w-[150px]`} />
        )}
      </div>
    </div>
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
        source: 'monday',            // 'monday' | 'sheets'
        name: '', boardId: '', boardName: '', triggerEvent: 'create_item',
        phoneColumnId: '', messageMode: 'template', messageTemplate: '',
        aiInstructions: '', senderPhoneNumberId: '',
        spreadsheetId: '', spreadsheetName: '', sheetId: null, sheetName: '',
        delayAmount: 0, delayUnit: 'minutes', businessHoursMode: 'anytime',
      }
    }
    const { amount, unit } = secondsToAmountUnit(automation.send_delay_seconds)
    return {
      source: automation.source || (automation.spreadsheet_id ? 'sheets' : 'monday'),
      name: automation.name || '',
      boardId: String(automation.board_id || ''),
      boardName: automation.board_name || '',
      triggerEvent: automation.trigger_event || 'create_item',
      // Sheets stores a column letter in phone_column; Monday a column id.
      phoneColumnId: automation.phone_column_id || automation.phone_column || '',
      messageMode: automation.message_mode || 'template',
      messageTemplate: automation.message_template || '',
      aiInstructions: automation.ai_instructions || '',
      senderPhoneNumberId: String(automation.sender_phone_number_id || ''),
      spreadsheetId: automation.spreadsheet_id || '',
      spreadsheetName: automation.spreadsheet_name || '',
      sheetId: automation.sheet_id ?? null,
      sheetName: automation.sheet_name || '',
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

  // Google Sheets pickers
  const [sheetsConnected, setSheetsConnected] = useState(null)   // null = unknown
  const [spreadsheets, setSpreadsheets] = useState([])
  const [tabs, setTabs] = useState([])
  const [sheetColumns, setSheetColumns] = useState([])
  const [loadingSheets, setLoadingSheets] = useState({ spreadsheets: false, tabs: false, columns: false })
  const isSheets = form.source === 'sheets'

  // Two-way Monday sync (writeback) — per-board, mirrors the list-page feature.
  const [wbSentCol, setWbSentCol] = useState('')
  const [wbSentLabel, setWbSentLabel] = useState('')
  const [wbSentText, setWbSentText] = useState('')
  const [wbReplyCol, setWbReplyCol] = useState('')
  const [wbReplyLabel, setWbReplyLabel] = useState('')
  const [wbReplyText, setWbReplyText] = useState('')
  const [wbDoneCol, setWbDoneCol] = useState('')
  const [wbDoneLabel, setWbDoneLabel] = useState('')
  const [wbDoneText, setWbDoneText] = useState('')
  // Columns we can write back to (status / date / text only).
  const wbColumns = columns.filter(c => c.type === 'status' || c.type === 'date' || c.type === 'text')
  // Placeholder chips for the template editor come from whichever source is active.
  const placeholderCols = isSheets ? sheetColumns : columns
  const placeholderSeed = isSheets ? 'name' : 'item_name'

  useEffect(() => {
    if (isEdit) return
    fetchWithWorkspace('/api/integrations/monday/boards')
      .then(r => r.json())
      .then(d => setBoards(d?.boards || []))
      .catch(() => setBoards([]))
      .finally(() => setLoadingBoards(false))
    fetchWithWorkspace('/api/integrations/google-sheets')
      .then(r => r.json())
      .then(d => setSheetsConnected(!!d?.connected))
      .catch(() => setSheetsConnected(false))
  }, [isEdit])

  // Sheets: load the spreadsheet list once the source is switched to sheets.
  useEffect(() => {
    if (isEdit || !isSheets || spreadsheets.length > 0) return
    setLoadingSheets(p => ({ ...p, spreadsheets: true }))
    fetchWithWorkspace('/api/integrations/google-sheets/spreadsheets')
      .then(r => r.json())
      .then(d => setSpreadsheets(d?.spreadsheets || []))
      .catch(() => setSpreadsheets([]))
      .finally(() => setLoadingSheets(p => ({ ...p, spreadsheets: false })))
  }, [isEdit, isSheets, spreadsheets.length])

  // Sheets: load the tabs when a spreadsheet is picked.
  useEffect(() => {
    if (!isSheets || !form.spreadsheetId || isEdit) { setTabs([]); return }
    setLoadingSheets(p => ({ ...p, tabs: true }))
    setTabs([])
    fetchWithWorkspace(`/api/integrations/google-sheets/spreadsheets/${form.spreadsheetId}/tabs`)
      .then(r => r.json())
      .then(d => {
        const t = d?.tabs || []
        setTabs(t)
        // Single-tab sheets: select it automatically.
        if (t.length === 1) setForm(f => f.sheetName ? f : ({ ...f, sheetName: t[0].title, sheetId: t[0].id }))
      })
      .catch(() => setTabs([]))
      .finally(() => setLoadingSheets(p => ({ ...p, tabs: false })))
  }, [isSheets, form.spreadsheetId, isEdit])

  // Sheets: load header columns when a tab is picked (also in edit mode, for
  // the placeholder chips and the writeback editors).
  useEffect(() => {
    if (!isSheets || !form.spreadsheetId || !form.sheetName) { setSheetColumns([]); return }
    setLoadingSheets(p => ({ ...p, columns: true }))
    setSheetColumns([])
    fetchWithWorkspace(`/api/integrations/google-sheets/spreadsheets/${form.spreadsheetId}/columns?sheet=${encodeURIComponent(form.sheetName)}`)
      .then(r => r.json())
      .then(d => {
        const cols = d?.columns || []
        setSheetColumns(cols)
        const phoneCol = cols.find(c => c.isPhoneType)
        if (phoneCol) setForm(f => f.phoneColumnId ? f : ({ ...f, phoneColumnId: phoneCol.id }))
      })
      .catch(() => setSheetColumns([]))
      .finally(() => setLoadingSheets(p => ({ ...p, columns: false })))
  }, [isSheets, form.spreadsheetId, form.sheetName])

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
    if (isSheets || !form.boardId) return
    fetchWithWorkspace('/api/automations/writeback')
      .then(r => r.json())
      .then(d => {
        const cfg = (d?.configs || []).find(c => String(c.board_id) === String(form.boardId))
        if (!cfg) return
        setWbSentCol(cfg.on_sent_column_id || '')
        setWbSentLabel(cfg.on_sent_value?.label || '')
        setWbSentText(cfg.on_sent_value?.text || '')
        setWbReplyCol(cfg.on_reply_column_id || '')
        setWbReplyLabel(cfg.on_reply_value?.label || '')
        setWbReplyText(cfg.on_reply_value?.text || '')
        setWbDoneCol(cfg.on_done_column_id || '')
        setWbDoneLabel(cfg.on_done_value?.label || '')
        setWbDoneText(cfg.on_done_value?.text || '')
      })
      .catch(() => {})
  }, [isSheets, form.boardId])

  // Same prefill for the sheets writeback config (per spreadsheet + tab).
  // Reuses the *Col/*Text state — sheets has no status labels, only text.
  useEffect(() => {
    if (!isSheets || !form.spreadsheetId || !form.sheetName) return
    fetchWithWorkspace('/api/automations/sheets-writeback')
      .then(r => r.json())
      .then(d => {
        const cfg = (d?.configs || []).find(c =>
          String(c.spreadsheet_id) === String(form.spreadsheetId) && c.sheet_name === form.sheetName)
        if (!cfg) return
        setWbSentCol(cfg.on_sent_column || '')
        setWbSentText(cfg.on_sent_value || '')
        setWbReplyCol(cfg.on_reply_column || '')
        setWbReplyText(cfg.on_reply_value || '')
        setWbDoneCol(cfg.on_done_column || '')
        setWbDoneText(cfg.on_done_value || '')
      })
      .catch(() => {})
  }, [isSheets, form.spreadsheetId, form.sheetName])

  const submit = async () => {
    setError('')
    if (!form.name.trim()) return setError('Give the automation a name.')
    if (isSheets) {
      if (!form.spreadsheetId) return setError('Pick a spreadsheet.')
      if (!form.sheetName) return setError('Pick a sheet tab.')
    } else {
      if (!form.boardId) return setError('Pick a board.')
    }
    if (!form.phoneColumnId) return setError('Pick the phone-number column.')
    if (!form.senderPhoneNumberId) return setError('Pick a sender number.')
    if (form.messageMode === 'template' && !form.messageTemplate.trim()) return setError('Write a message template.')
    if (form.messageMode === 'ai' && !form.aiInstructions.trim()) return setError('Write the AI instructions.')

    setSubmitting(true)
    try {
      const url = isEdit ? `/api/automations/${automation.id}` : '/api/automations'
      const method = isEdit ? 'PATCH' : 'POST'
      const common = {
        name: form.name,
        message_mode: form.messageMode,
        message_template: form.messageTemplate,
        ai_instructions: form.aiInstructions,
        sender_phone_number_id: form.senderPhoneNumberId,
        send_delay_seconds: delayToSeconds(form.delayAmount, form.delayUnit),
        business_hours_mode: form.businessHoursMode,
      }
      const payload = isSheets
        ? (isEdit
            ? { ...common, phone_column: form.phoneColumnId }
            : {
                ...common,
                source: 'sheets',
                spreadsheet_id: form.spreadsheetId,
                spreadsheet_name: form.spreadsheetName,
                sheet_id: form.sheetId,
                sheet_name: form.sheetName,
                phone_column: form.phoneColumnId,
              })
        : (isEdit
            ? { ...common, phone_column_id: form.phoneColumnId }
            : {
                ...common,
                board_id: form.boardId,
                board_name: form.boardName,
                trigger_event: form.triggerEvent,
                phone_column_id: form.phoneColumnId,
              })

      const res = await fetchWithWorkspace(url, { method, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok || !data.success) { setError(data.error || (isEdit ? 'Failed to save changes' : 'Failed to create automation')); return }

      // Persist the two-way sync rules (best-effort — never blocks the
      // automation from being created). Only upsert when something changed —
      // either a rule is set now, or we're editing (so clears are saved too).
      if (isSheets) {
        if (form.spreadsheetId && form.sheetName && (isEdit || wbSentCol || wbReplyCol || wbDoneCol)) {
          await fetchWithWorkspace('/api/automations/sheets-writeback', {
            method: 'POST',
            body: JSON.stringify({
              spreadsheet_id: form.spreadsheetId,
              sheet_id: form.sheetId,
              sheet_name: form.sheetName,
              on_sent_column: wbSentCol || null, on_sent_value: wbSentText || null,
              on_reply_column: wbReplyCol || null, on_reply_value: wbReplyText || null,
              on_done_column: wbDoneCol || null, on_done_value: wbDoneText || null,
            }),
          }).catch(() => {})
        }
      } else {
        const wbPayload = (colId, label, text) => {
          const col = wbColumns.find(c => c.id === colId)
          if (!colId || !col) return { columnId: null, columnType: null, value: null }
          if (col.type === 'status') return { columnId: colId, columnType: 'status', value: { label } }
          if (col.type === 'date')   return { columnId: colId, columnType: 'date',   value: null }
          if (col.type === 'text')   return { columnId: colId, columnType: 'text',   value: { text } }
          return { columnId: null, columnType: null, value: null }
        }
        if (form.boardId && (isEdit || wbSentCol || wbReplyCol || wbDoneCol)) {
          const sentWb = wbPayload(wbSentCol, wbSentLabel, wbSentText)
          const reply = wbPayload(wbReplyCol, wbReplyLabel, wbReplyText)
          const done = wbPayload(wbDoneCol, wbDoneLabel, wbDoneText)
          await fetchWithWorkspace('/api/automations/writeback', {
            method: 'POST',
            body: JSON.stringify({
              board_id: form.boardId,
              board_name: form.boardName || automation?.board_name,
              on_sent_column_id: sentWb.columnId, on_sent_column_type: sentWb.columnType, on_sent_value: sentWb.value,
              on_reply_column_id: reply.columnId, on_reply_column_type: reply.columnType, on_reply_value: reply.value,
              on_done_column_id: done.columnId, on_done_column_type: done.columnType, on_done_value: done.value,
            }),
          }).catch(() => {})
        }
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

          {/* 1 ── Trigger (Monday board or Google Sheet) */}
          <FlowCard
            accent={isSheets ? '#0F9D58' : '#6161FF'}
            badgeBg="#FFFFFF"
            badge={isSheets ? <SheetsLogo size={16} /> : <MondayLogo size={16} />}
            title="When this happens"
            subtitle={isSheets ? 'Trigger — Google Sheet' : 'Trigger — Monday board'}
          >
            {!isEdit && (
              <div>
                <label className={labelCls}>Source</label>
                <div className="flex gap-2">
                  {[['monday', 'Monday board', true], ['sheets', 'Google Sheet', sheetsConnected !== false]].map(([v, l, enabled]) => (
                    <button key={v} type="button" disabled={!enabled}
                      title={enabled ? '' : 'Connect Google Sheets in Settings → Integrations first'}
                      onClick={() => setForm(f => ({ ...f, source: v, phoneColumnId: '' }))}
                      className={`flex-1 px-3 py-2 text-xs font-medium rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${form.source === v ? 'bg-[#fdecea] border-[#D63B1F] text-[#D63B1F]' : 'bg-[#FFFFFF] border-[#E3E1DB] text-[#5C5A55] hover:bg-[#F7F6F3]'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isSheets ? (
              <>
                <div>
                  <label className={labelCls}>Spreadsheet *</label>
                  {isEdit ? (
                    <div className="px-3 py-2.5 border border-[#E3E1DB] rounded-lg text-sm bg-[#F7F6F3] text-[#5C5A55]">{form.spreadsheetName || form.spreadsheetId}</div>
                  ) : (
                    <SearchableDropdown
                      value={form.spreadsheetId}
                      onChange={(v) => {
                        const s = spreadsheets.find(x => x.id === v)
                        setForm(f => ({ ...f, spreadsheetId: v, spreadsheetName: s?.name || '', sheetName: '', sheetId: null, phoneColumnId: '' }))
                      }}
                      options={spreadsheets.map(s => ({ value: s.id, label: s.name, searchText: s.name }))}
                      placeholder={loadingSheets.spreadsheets ? 'Loading spreadsheets…' : 'Select a spreadsheet'}
                      loading={loadingSheets.spreadsheets}
                      renderSelected={(o) => o.label}
                      renderOption={(o) => <p className="text-sm text-[#131210]">{o.label}</p>}
                    />
                  )}
                </div>
                <div>
                  <label className={labelCls}>Sheet tab *</label>
                  {isEdit ? (
                    <div className="px-3 py-2.5 border border-[#E3E1DB] rounded-lg text-sm bg-[#F7F6F3] text-[#5C5A55]">{form.sheetName}</div>
                  ) : form.spreadsheetId ? (
                    <select className={inputCls} value={form.sheetName}
                      onChange={e => {
                        const t = tabs.find(x => x.title === e.target.value)
                        setForm(f => ({ ...f, sheetName: e.target.value, sheetId: t?.id ?? null, phoneColumnId: '' }))
                      }}>
                      <option value="">{loadingSheets.tabs ? 'Loading tabs…' : 'Select a tab'}</option>
                      {tabs.map(t => <option key={t.id} value={t.title}>{t.title}</option>)}
                    </select>
                  ) : (
                    <div className="px-3 py-2.5 border border-dashed border-[#D4D1C9] rounded-lg text-sm bg-[#F7F6F3] text-[#9B9890]">Pick a spreadsheet first</div>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Trigger</label>
                  <div className="px-3 py-2.5 border border-[#E3E1DB] rounded-lg text-sm bg-[#F7F6F3] text-[#5C5A55]">New row added</div>
                  <p className="text-[11px] text-[#9B9890] mt-1">The sheet is checked about once a minute. Row 1 must be a header row; new rows below it trigger the text.</p>
                </div>
                {isEdit && (
                  <p className="text-[11px] text-[#9B9890]">Spreadsheet and tab are locked because the send history is bound to them. To change either, delete this automation and create a new one.</p>
                )}
                <div>
                  <label className={labelCls}>Phone number column *</label>
                  {form.sheetName ? (
                    <SearchableDropdown
                      value={form.phoneColumnId}
                      onChange={(v) => setForm(f => ({ ...f, phoneColumnId: v }))}
                      options={sheetColumns.map(c => ({ value: c.id, label: c.title, type: c.id, searchText: `${c.title} ${c.id}` }))}
                      placeholder={loadingSheets.columns ? 'Loading columns…' : 'Select the phone column'}
                      loading={loadingSheets.columns}
                      renderSelected={(o) => o.label}
                      renderOption={(o) => (
                        <div>
                          <p className="text-sm text-[#131210]">{o.label}</p>
                          <p className="text-xs text-[#9B9890] font-mono mt-0.5">column {o.type}</p>
                        </div>
                      )}
                    />
                  ) : (
                    <div className="px-3 py-2.5 border border-dashed border-[#D4D1C9] rounded-lg text-sm bg-[#F7F6F3] text-[#9B9890]">Pick a sheet tab first</div>
                  )}
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
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
                    placeholder="Hi {{first_name}}, thanks for your interest! …"
                    onChange={e => setForm(f => ({ ...f, messageTemplate: e.target.value }))} />
                  {placeholderCols.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="text-[11px] text-[#9B9890]">Placeholders:</span>
                      {[...new Set([placeholderSeed, ...placeholderCols.map(c => c.placeholder).filter(Boolean)])].map(p => (
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

          {/* 4 ── Two-way sync (writeback to Monday or the sheet) */}
          <FlowCard accent="#16A34A" width="w-[380px]" badge={<i className="fas fa-rotate text-white text-xs" />} title={isSheets ? 'Sync back to the sheet' : 'Sync back to Monday'} subtitle="Two-way sync — optional">
            {isSheets ? (
              form.sheetName ? (
                <>
                  <SheetEventEditor
                    title="When the first message is sent"
                    hint="Written the moment the AI/template goes out — e.g. Status = AI Engaged."
                    columns={sheetColumns}
                    col={wbSentCol} setCol={setWbSentCol}
                    value={wbSentText} setValue={setWbSentText}
                  />
                  <div className="border-t border-[#EFEDE8] pt-3 mt-3">
                    <SheetEventEditor
                      title="When a lead replies"
                      hint="Written on every inbound message — e.g. Status = Replied."
                      columns={sheetColumns}
                      col={wbReplyCol} setCol={setWbReplyCol}
                      value={wbReplyText} setValue={setWbReplyText}
                    />
                  </div>
                  <div className="border-t border-[#EFEDE8] pt-3 mt-3">
                    <SheetEventEditor
                      title="When marked done"
                      hint="Written when you toggle the chat to Done / Closed."
                      columns={sheetColumns}
                      col={wbDoneCol} setCol={setWbDoneCol}
                      value={wbDoneText} setValue={setWbDoneText}
                    />
                  </div>
                  <p className="text-[11px] text-[#9B9890] mt-2">Tip: write <span className="font-mono">{'{{date}}'}</span> to stamp today&rsquo;s date (e.g. a &ldquo;Last Contacted&rdquo; column).</p>
                </>
              ) : (
                <div className="px-3 py-2.5 border border-dashed border-[#D4D1C9] rounded-lg text-sm bg-[#F7F6F3] text-[#9B9890]">Pick a sheet tab first</div>
              )
            ) : form.boardId ? (
              <>
                <EventEditor
                  title="When the first message is sent"
                  hint="Set the moment the AI/template goes out — e.g. Status = AI Engaged / Template Sent."
                  columns={wbColumns}
                  colId={wbSentCol} setColId={setWbSentCol}
                  valueLabel={wbSentLabel} setValueLabel={setWbSentLabel}
                  valueText={wbSentText} setValueText={setWbSentText}
                />
                <div className="border-t border-[#EFEDE8] pt-3 mt-3">
                  <EventEditor
                    title="When a lead replies"
                    hint="Set on every inbound message — e.g. Status = Replied / Engaged."
                    columns={wbColumns}
                    colId={wbReplyCol} setColId={setWbReplyCol}
                    valueLabel={wbReplyLabel} setValueLabel={setWbReplyLabel}
                    valueText={wbReplyText} setValueText={setWbReplyText}
                  />
                </div>
                <div className="border-t border-[#EFEDE8] pt-3 mt-3">
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
