'use client'

import { useState, useEffect } from 'react'
import { ReactFlow, Background, Controls, addEdge, useNodesState, useEdgesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { fetchWithWorkspace } from '@/lib/api-client'
import { nodeTypes } from '@/components/automations/AutomationNodes'
import { NODE, buildGraphFromAutomation, flattenGraphToPayload, validateGraph } from '@/lib/automation-graph'

// ── shared bits (kept local so the builder is a self-contained page) ────────
const inputCls = 'w-full px-3 py-2.5 border border-[#D4D1C9] rounded-lg text-sm bg-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]'
const labelCls = 'block text-sm font-medium text-[#5C5A55] mb-1.5'

// Drop the injected callbacks + lookup arrays before a node's data is persisted
// to the graph column (they're wired in fresh on every render).
const stripCallbacks = ({ onChange, onDelete, boards, phoneNumbers, columns, ...rest }) => rest

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

// A titled panel that hosts the writeback editors below the canvas.
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
  // The provider is fixed for the lifetime of the builder — GET tags every row
  // with `source`, and new automations default to Monday.
  const source = automation?.source || 'monday'
  const isSheets = source === 'sheets'

  // ── Canvas state — seeded from the automation's stored graph (edit) or a
  // fresh trigger → wait → send line auto-laid-out from the flat columns.
  const initial = buildGraphFromAutomation(automation || {})
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)

  const [name, setName] = useState(automation?.name || '')

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

  // The trigger target is the canvas's single source of truth — derive the
  // selected board / spreadsheet / tab from the Trigger node's data so the
  // loaders and the writeback panel key off it.
  const triggerData = nodes.find(n => n.type === NODE.TRIGGER)?.data || {}
  const selBoardId = triggerData.board_id ? String(triggerData.board_id) : ''
  const selSpreadsheetId = triggerData.spreadsheet_id ? String(triggerData.spreadsheet_id) : ''
  const selSheetName = triggerData.sheet_name || ''

  // ── Canvas mutators ───────────────────────────────────────────────────────
  // In edit mode the Trigger's identity fields are locked — changing board/
  // trigger/spreadsheet here doesn't recreate the Monday/Sheets webhook, so
  // letting them through would silently point phone_column_id at the wrong
  // board. phone_column_id itself stays editable (that's the intended edit).
  const updateNodeData = (id, patch) => {
    if (isEdit && id === 'trigger') {
      const { board_id, board_name, trigger_event, spreadsheet_id, spreadsheet_name, sheet_id, sheet_name, ...safe } = patch
      patch = safe
    }
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
  }
  const deleteNode = (id) => {
    setNodes(nds => nds.filter(n => n.id !== id))
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id))
  }
  const onConnect = (p) => setEdges(eds => addEdge({ ...p, animated: true }, eds))

  // Inject callbacks + lookups into every node's data on each render (the
  // Trigger node is not deletable — omitting onDelete hides its × button).
  const rfNodes = nodes.map(n => ({
    ...n,
    data: { ...n.data, onChange: updateNodeData, onDelete: n.type === NODE.TRIGGER ? undefined : deleteNode, boards, phoneNumbers, columns },
  }))

  // Add-block palette — one instance of each type, wired onto the end of the line.
  const hasType = (t) => nodes.some(n => n.type === t)
  const addNode = (type) => {
    if (hasType(type)) return
    const x = 40 + nodes.length * 300, y = 60
    const id = type
    const seed = type === NODE.WAIT ? { send_delay_seconds: 0, business_hours_mode: 'anytime' } : {}
    const last = nodes[nodes.length - 1]
    setNodes(nds => [...nds, { id, type, position: { x, y }, data: seed }])
    if (last) setEdges(eds => addEdge({ id: `e-${last.id}-${id}`, source: last.id, target: id, animated: true }, eds))
  }

  // ── Data loaders (preserved from the original card-based builder) ──────────
  useEffect(() => {
    fetchWithWorkspace('/api/integrations/monday/boards')
      .then(r => r.json())
      .then(d => setBoards(d?.boards || []))
      .catch(() => setBoards([]))
      .finally(() => setLoadingBoards(false))
    fetchWithWorkspace('/api/integrations/google-sheets')
      .then(r => r.json())
      .then(d => setSheetsConnected(!!d?.connected))
      .catch(() => setSheetsConnected(false))
  }, [])

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
    if (!isSheets || !selSpreadsheetId || isEdit) { setTabs([]); return }
    setLoadingSheets(p => ({ ...p, tabs: true }))
    setTabs([])
    fetchWithWorkspace(`/api/integrations/google-sheets/spreadsheets/${selSpreadsheetId}/tabs`)
      .then(r => r.json())
      .then(d => {
        const t = d?.tabs || []
        setTabs(t)
        // Single-tab sheets: select it automatically on the Trigger node.
        if (t.length === 1) setNodes(nds => nds.map(n =>
          (n.type === NODE.TRIGGER && !n.data.sheet_name)
            ? { ...n, data: { ...n.data, sheet_name: t[0].title, sheet_id: t[0].id } } : n))
      })
      .catch(() => setTabs([]))
      .finally(() => setLoadingSheets(p => ({ ...p, tabs: false })))
  }, [isSheets, selSpreadsheetId, isEdit])

  // Sheets: load header columns when a tab is picked (also in edit mode, for
  // the writeback editors).
  useEffect(() => {
    if (!isSheets || !selSpreadsheetId || !selSheetName) { setSheetColumns([]); return }
    setLoadingSheets(p => ({ ...p, columns: true }))
    setSheetColumns([])
    fetchWithWorkspace(`/api/integrations/google-sheets/spreadsheets/${selSpreadsheetId}/columns?sheet=${encodeURIComponent(selSheetName)}`)
      .then(r => r.json())
      .then(d => {
        const cols = d?.columns || []
        setSheetColumns(cols)
        const phoneCol = cols.find(c => c.isPhoneType)
        if (phoneCol) setNodes(nds => nds.map(n =>
          (n.type === NODE.TRIGGER && !n.data.phone_column)
            ? { ...n, data: { ...n.data, phone_column: phoneCol.id } } : n))
      })
      .catch(() => setSheetColumns([]))
      .finally(() => setLoadingSheets(p => ({ ...p, columns: false })))
  }, [isSheets, selSpreadsheetId, selSheetName])

  // Monday: load the selected board's columns (drives the Trigger node's phone
  // dropdown + the writeback editors). Auto-selects a phone-type column once.
  useEffect(() => {
    if (!selBoardId) { setColumns([]); return }
    setLoadingColumns(true)
    setColumns([])
    fetchWithWorkspace(`/api/integrations/monday/boards/${selBoardId}/columns`)
      .then(r => r.json())
      .then(d => {
        const cols = d?.columns || []
        setColumns(cols)
        const phoneCol = cols.find(c => c.isPhoneType)
        if (phoneCol) setNodes(nds => nds.map(n =>
          (n.type === NODE.TRIGGER && !n.data.phone_column_id)
            ? { ...n, data: { ...n.data, phone_column_id: phoneCol.id } } : n))
      })
      .catch(() => setColumns([]))
      .finally(() => setLoadingColumns(false))
  }, [selBoardId])

  // Prefill the two-way sync card from any existing writeback config for the board.
  useEffect(() => {
    if (isSheets || !selBoardId) return
    fetchWithWorkspace('/api/automations/writeback')
      .then(r => r.json())
      .then(d => {
        const cfg = (d?.configs || []).find(c => String(c.board_id) === String(selBoardId))
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
  }, [isSheets, selBoardId])

  // Same prefill for the sheets writeback config (per spreadsheet + tab).
  // Reuses the *Col/*Text state — sheets has no status labels, only text.
  useEffect(() => {
    if (!isSheets || !selSpreadsheetId || !selSheetName) return
    fetchWithWorkspace('/api/automations/sheets-writeback')
      .then(r => r.json())
      .then(d => {
        const cfg = (d?.configs || []).find(c =>
          String(c.spreadsheet_id) === String(selSpreadsheetId) && c.sheet_name === selSheetName)
        if (!cfg) return
        setWbSentCol(cfg.on_sent_column || '')
        setWbSentText(cfg.on_sent_value || '')
        setWbReplyCol(cfg.on_reply_column || '')
        setWbReplyText(cfg.on_reply_value || '')
        setWbDoneCol(cfg.on_done_column || '')
        setWbDoneText(cfg.on_done_value || '')
      })
      .catch(() => {})
  }, [isSheets, selSpreadsheetId, selSheetName])

  const submit = async () => {
    setError('')
    if (!name.trim()) return setError('Give the automation a name.')

    // Flatten the canvas to the graph shape (strip the transient callbacks/lookups).
    const graph = {
      nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data: stripCallbacks(data) })),
      edges: edges.map(({ id, source: s, target }) => ({ id, source: s, target })),
    }
    const errors = validateGraph(graph, source)
    if (errors.length) return setError(errors[0])

    setSubmitting(true)
    try {
      const url = isEdit ? `/api/automations/${automation.id}` : '/api/automations'
      const method = isEdit ? 'PATCH' : 'POST'
      const payload = { name: name.trim(), ...flattenGraphToPayload(graph, source) }

      const res = await fetchWithWorkspace(url, { method, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok || !data.success) { setError(data.error || (isEdit ? 'Failed to save changes' : 'Failed to create automation')); return }

      // Persist the two-way sync rules (best-effort — never blocks the
      // automation from being created). The trigger target comes from the
      // canvas Trigger node. Only upsert when something changed — either a rule
      // is set now, or we're editing (so clears are saved too).
      const td = nodes.find(n => n.type === NODE.TRIGGER)?.data || {}
      if (isSheets) {
        if (td.spreadsheet_id && td.sheet_name && (isEdit || wbSentCol || wbReplyCol || wbDoneCol)) {
          await fetchWithWorkspace('/api/automations/sheets-writeback', {
            method: 'POST',
            body: JSON.stringify({
              spreadsheet_id: td.spreadsheet_id,
              sheet_id: td.sheet_id,
              sheet_name: td.sheet_name,
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
        if (td.board_id && (isEdit || wbSentCol || wbReplyCol || wbDoneCol)) {
          const sentWb = wbPayload(wbSentCol, wbSentLabel, wbSentText)
          const reply = wbPayload(wbReplyCol, wbReplyLabel, wbReplyText)
          const done = wbPayload(wbDoneCol, wbDoneLabel, wbDoneText)
          await fetchWithWorkspace('/api/automations/writeback', {
            method: 'POST',
            body: JSON.stringify({
              board_id: td.board_id,
              board_name: td.board_name || automation?.board_name,
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
            value={name}
            placeholder={isEdit ? 'Automation name' : 'Untitled automation'}
            onChange={e => setName(e.target.value)}
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

      {/* Canvas — drag-and-drop node builder + the writeback panel below it */}
      <div className="flex-1 overflow-auto p-6 space-y-5" style={{ background: '#FAF9F6' }}>
        {/* Add-block palette — one of each type */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#9B9890]">Add block:</span>
          {[[NODE.WAIT, 'When to send'], [NODE.SEND, 'Send a text'], [NODE.SYNC, 'Sync back']].map(([t, l]) => (
            <button key={t} type="button" onClick={() => addNode(t)} disabled={hasType(t)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-[#E3E1DB] bg-white text-[#5C5A55] hover:bg-[#F7F6F3] disabled:opacity-40 disabled:cursor-not-allowed">
              + {l}
            </button>
          ))}
        </div>

        {/* React-Flow canvas */}
        <div style={{ height: 520, border: '1px solid #E8E8E4', borderRadius: 8, position: 'relative', background: '#fff' }}>
          <ReactFlow
            nodes={rfNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#E8E8E4" gap={22} />
            <Controls />
          </ReactFlow>
        </div>

        {/* Two-way sync (writeback to Monday or the sheet) — the Sync node on the
            canvas is a visual marker; the columns are configured here. */}
        <FlowCard accent="#16A34A" width="w-full max-w-3xl" badge={<i className="fas fa-rotate text-white text-xs" />}
          title={isSheets ? 'Sync back to the sheet' : 'Sync back to Monday'} subtitle="Two-way sync — optional">
          {isSheets ? (
            selSheetName ? (
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
          ) : selBoardId ? (
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
  )
}
