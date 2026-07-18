'use client'

import { useState, useEffect, useRef } from 'react'
import { ReactFlow, Background, Controls, addEdge, useNodesState, useEdgesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { fetchWithWorkspace } from '@/lib/api-client'
import { nodeTypes } from '@/components/automations/AutomationNodes'
import { NODE, buildGraphFromAutomation, flattenGraphToPayload, validateGraph } from '@/lib/automation-graph'

// Drop the injected ctx (callbacks + lookups + writeback state) before a node's
// data is persisted to the graph column — it's wired in fresh on every render.
const stripCallbacks = ({ ctx, ...rest }) => rest

// Every block type the "Add block" dropdown can offer (Trigger is always on the
// canvas, so it shows as permanently added).
const BLOCKS = [
  { type: NODE.TRIGGER, label: 'When this happens', hint: 'Trigger — Monday board', color: '#6161FF' },
  { type: NODE.WAIT, label: 'When to send', hint: 'Delay & business hours', color: '#2563EB' },
  { type: NODE.SEND, label: 'Send a text', hint: 'SMS to the new lead', color: '#D63B1F' },
  { type: NODE.SYNC, label: 'Sync back', hint: 'Two-way sync — optional', color: '#16A34A' },
]

export default function AutomationBuilder({ phoneNumbers = [], automation = null, initialSource = 'monday', onSaved, onCancel }) {
  const isEdit = !!automation
  // The provider is fixed for the lifetime of the builder — GET tags every row
  // with `source`; a NEW automation takes its source from the picker (initialSource).
  const source = automation?.source || initialSource || 'monday'
  const isSheets = source === 'sheets'

  // ── Canvas state ──────────────────────────────────────────────────────────
  // New automation: start with just the Trigger — the user adds and wires the
  // rest from the palette. Edit: load the stored graph (or synthesize the line
  // from the flat columns for pre-graph automations).
  const initial = automation
    ? buildGraphFromAutomation(automation)
    : { nodes: [{ id: 'trigger', type: NODE.TRIGGER, position: { x: 80, y: 80 }, data: isSheets ? {} : { trigger_event: 'create_item' } }], edges: [] }
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
  // loaders and the writeback editors key off it.
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

  // Everything transient the nodes need — callbacks, lookup lists, and the
  // writeback state/setters — bundled under `data.ctx` (stripped before save).
  const ctx = {
    isEdit,
    isSheets,
    onChange: updateNodeData,
    onDelete: deleteNode,
    boards, columns, loadingBoards, loadingColumns,
    spreadsheets, tabs, sheetColumns, loadingSheets,
    phoneNumbers,
    placeholderCols: isSheets ? sheetColumns : columns,
    placeholderSeed: isSheets ? 'name' : 'item_name',
    wb: {
      isSheets, columns: wbColumns, sheetColumns, selBoardId, selSheetName,
      sentCol: wbSentCol, setSentCol: setWbSentCol, sentLabel: wbSentLabel, setSentLabel: setWbSentLabel, sentText: wbSentText, setSentText: setWbSentText,
      replyCol: wbReplyCol, setReplyCol: setWbReplyCol, replyLabel: wbReplyLabel, setReplyLabel: setWbReplyLabel, replyText: wbReplyText, setReplyText: setWbReplyText,
      doneCol: wbDoneCol, setDoneCol: setWbDoneCol, doneLabel: wbDoneLabel, setDoneLabel: setWbDoneLabel, doneText: wbDoneText, setDoneText: setWbDoneText,
    },
  }
  const rfNodes = nodes.map(n => ({ ...n, data: { ...n.data, ctx } }))

  // Add-block dropdown — one instance of each type, dropped to the right. No
  // auto-edge: the user wires it up manually by dragging between the dots.
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef(null)
  useEffect(() => {
    if (!addOpen) return
    // Capture-phase pointerdown so a click on the React Flow canvas (which
    // suppresses the compatibility mousedown) still closes the menu.
    const h = (e) => { if (!addRef.current?.contains(e.target)) setAddOpen(false) }
    document.addEventListener('pointerdown', h, true)
    return () => document.removeEventListener('pointerdown', h, true)
  }, [addOpen])

  const hasType = (t) => nodes.some(n => n.type === t)
  const addNode = (type) => {
    if (hasType(type)) return
    const x = 80 + nodes.length * 480, y = 80
    const seed = type === NODE.WAIT ? { send_delay_seconds: 0, business_hours_mode: 'anytime', delay_unit: 'minutes' } : {}
    setNodes(nds => [...nds, { id: type, type, position: { x, y }, data: seed }])
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

  // Prefill the two-way sync from any existing writeback config for the board.
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

    // Flatten the canvas to the graph shape (strip the transient ctx).
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

      {/* Canvas — drag-and-drop node builder; each block carries its own fields */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#FAF9F6' }}>
        {/* Add-block button + dropdown — lists every block; ones already on the
            canvas are disabled, and re-enable when removed via the × button. */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-[#E8E8E4] bg-white/70 shrink-0">
          <div className="relative" ref={addRef}>
            <button type="button" onClick={() => setAddOpen(o => !o)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border border-[#E3E1DB] bg-white text-[#131210] hover:bg-[#F7F6F3]">
              <span className="w-4 h-4 rounded bg-[#D63B1F] text-white inline-flex items-center justify-center text-[13px] leading-none">+</span>
              Add block
              <svg className={`w-3.5 h-3.5 text-[#9B9890] transition-transform ${addOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
            </button>
            {addOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-64 bg-white border border-[#E3E1DB] rounded-lg shadow-xl z-20 py-1">
                {BLOCKS.map(b => {
                  const added = hasType(b.type)
                  return (
                    <button key={b.type} type="button" disabled={added}
                      onClick={() => { addNode(b.type); setAddOpen(false) }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${added ? 'opacity-45 cursor-not-allowed' : 'hover:bg-[#F7F6F3]'}`}>
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[#131210] truncate">{b.label}</span>
                        <span className="block text-[11px] text-[#9B9890] truncate">{b.hint}</span>
                      </span>
                      {added && <span className="text-[10px] font-semibold text-[#9B9890] uppercase tracking-wide shrink-0">Added</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <span className="text-[11px] text-[#B5B2AA]">Drag a block’s dot onto another block to connect them.</span>
        </div>

        {/* React-Flow canvas fills the remaining height */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={rfNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
            defaultEdgeOptions={{ animated: true, style: { stroke: '#D63B1F', strokeWidth: 2 } }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#E0DED7" gap={18} />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </div>
  )
}
