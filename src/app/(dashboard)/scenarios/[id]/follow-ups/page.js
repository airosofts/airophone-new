'use client'

// Full-page drag-and-drop follow-up sequence builder. Flexible nodes/branches
// on the existing linear engine: the not_responded chain from the Trigger is
// serialised to ordered scenario_followup_stages; "if replied → End" edges are
// visual (the engine stops on any reply). Reads/writes the same APIs as before.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, MarkerType } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { apiGet, apiPost, fetchWithWorkspace } from '@/lib/api-client'
import { followUpNodeTypes } from '@/components/scenarios/FollowUpNodes'
import { NODE, HANDLE, buildGraphFromScenario, flattenGraphToStages, validateGraph } from '@/lib/followup-graph'

const DAYS = [{ n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' }, { n: 4, l: 'T' }, { n: 5, l: 'F' }, { n: 6, l: 'S' }, { n: 7, l: 'S' }]
const TIMEZONES = [
  { v: 'America/New_York', l: 'Eastern (ET)' }, { v: 'America/Chicago', l: 'Central (CT)' },
  { v: 'America/Denver', l: 'Mountain (MT)' }, { v: 'America/Los_Angeles', l: 'Pacific (PT)' },
  { v: 'America/Phoenix', l: 'Arizona' }, { v: 'America/Anchorage', l: 'Alaska' },
  { v: 'Pacific/Honolulu', l: 'Hawaii' }, { v: 'UTC', l: 'UTC' },
]
const inputCls = 'px-2.5 py-2 border border-[#D4D1C9] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#D63B1F] focus:border-[#D63B1F]'

const COL = 360
const strip = ({ ctx, ...rest }) => rest
function decorate(e) {
  const stop = e.sourceHandle === HANDLE.STOP
  const stroke = stop ? '#16A34A' : '#D63B1F'
  return {
    ...e, type: 'smoothstep', animated: true, label: stop ? 'if replied' : 'if no reply',
    deletable: !stop,   // the replied → End edge can't be disconnected (engine reply-stop)
    labelStyle: { fill: stroke, fontSize: 10, fontWeight: 700 }, labelBgStyle: { fill: '#fff', fillOpacity: 0.9 }, labelBgPadding: [4, 2], labelBgBorderRadius: 3,
    style: { stroke, strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
  }
}
// Drop any End node left with no incoming edge (orphaned after a delete / rewire).
function prune(nodes, edges) {
  const incoming = new Set(edges.map(e => e.target))
  const keptNodes = nodes.filter(n => n.type !== NODE.END || incoming.has(n.id))
  const ids = new Set(keptNodes.map(n => n.id))
  return { nodes: keptNodes, edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)) }
}

export default function FollowUpSequencePage() {
  const { id } = useParams()
  const router = useRouter()
  const [scenarioName, setScenarioName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedTick, setSavedTick] = useState(false)
  const [statusCols, setStatusCols] = useState([])
  const [multiBoard, setMultiBoard] = useState(false)
  const [win, setWin] = useState({ enabled: false, days: [1, 2, 3, 4, 5, 6, 7], start: '08:00', end: '22:00', tz: 'America/New_York' })
  const [showAdd, setShowAdd] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const updateNodeData = useCallback((nid, patch) => setNodes(nds => nds.map(n => n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)), [setNodes])
  // plain fns (not memoised) so they close over the current nodes/edges for pruning
  const deleteNode = (nid) => {
    const p = prune(nodes.filter(n => n.id !== nid), edges.filter(e => e.source !== nid && e.target !== nid))
    setNodes(p.nodes); setEdges(p.edges)
  }

  const load = useCallback(async () => {
    try {
      const [scRes, stRes, mcRes] = await Promise.all([
        apiGet(`/api/scenarios/${id}`), apiGet(`/api/scenarios/${id}/followup-stages`), apiGet(`/api/scenarios/${id}/monday-status-columns`),
      ])
      const sc = await scRes.json().catch(() => ({}))
      const st = await stRes.json().catch(() => ({}))
      const mc = await mcRes.json().catch(() => ({}))
      const scenario = sc?.scenario || sc || {}
      setScenarioName(scenario.name || 'Scenario')
      setWin({
        enabled: !!scenario.enable_business_hours,
        days: (Array.isArray(scenario.followup_days) && scenario.followup_days.length) ? scenario.followup_days : [1, 2, 3, 4, 5, 6, 7],
        start: (scenario.followup_start_time || '08:00').slice(0, 5),
        end: (scenario.followup_end_time || '22:00').slice(0, 5),
        tz: scenario.followup_timezone || scenario.business_hours_timezone || 'America/New_York',
      })
      const boards = mc?.boards || []
      setMultiBoard(boards.length > 1)
      const map = new Map()
      for (const b of boards) for (const c of (b.columns || [])) {
        const ex = map.get(c.id)
        if (ex) ex.labels = [...new Set([...ex.labels, ...c.labels])]
        else map.set(c.id, { id: c.id, title: c.title, labels: [...c.labels], board_name: b.board_name })
      }
      setStatusCols([...map.values()])

      const stages = (st?.stages || [])
      const graph = buildGraphFromScenario(scenario, stages.length ? stages : [{ stage_number: 1, wait_duration: 1, wait_unit: 'days', instructions: '' }])
      setNodes(graph.nodes)
      setEdges((graph.edges || []).map(decorate))
    } catch {
      setError('Failed to load this sequence.')
    } finally {
      setLoading(false)
    }
  }, [id, setNodes, setEdges])
  useEffect(() => { load() }, [load])

  // Number each follow-up by its position on the not_responded chain.
  const orderIndex = useMemo(() => {
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
    const trigger = nodes.find(n => n.type === NODE.TRIGGER)
    const idx = {}
    if (!trigger) return idx
    let edge = edges.find(e => e.source === trigger.id)
    let i = 1; const seen = new Set()
    while (edge && byId[edge.target]?.type === NODE.FOLLOWUP && !seen.has(edge.target)) {
      seen.add(edge.target); idx[edge.target] = i++
      edge = edges.find(e => e.source === edge.target && e.sourceHandle === HANDLE.NEXT)
    }
    return idx
  }, [nodes, edges])

  const rfNodes = nodes.map(n => {
    if (n.type === NODE.FOLLOWUP) return { ...n, data: { ...n.data, ctx: { onChange: updateNodeData, onDelete: deleteNode, statusCols, multiBoard, index: orderIndex[n.id] } } }
    if (n.type === NODE.END) return { ...n, deletable: !n.data?.fixed, data: { ...n.data, ctx: { onDelete: deleteNode } } }
    return n
  })

  // one outgoing edge per source handle (single "next" / single "reply"); prune orphaned Ends.
  const onConnect = (p) => {
    const handle = p.sourceHandle || HANDLE.NEXT
    const base = edges.filter(e => !(e.source === p.source && e.sourceHandle === handle))
    const pr = prune(nodes, addEdge(decorate({ ...p, sourceHandle: handle }), base))
    setNodes(pr.nodes); setEdges(pr.edges)
  }

  const addNode = (type) => {
    setShowAdd(false)
    const uid = Date.now().toString(36)
    if (type === NODE.END) {
      setNodes(nds => [...nds, { id: `end-${uid}`, type: NODE.END, position: { x: 200, y: 700 }, data: { fixed: false } }])
      return
    }
    // A new follow-up ALWAYS ships with its fixed replied→End (built-in reply-stop)
    // and a removable no-reply→End. It floats until you wire it into the chain.
    const count = nodes.filter(n => n.type === NODE.FOLLOWUP).length
    const x = 40 + (count + 1) * COL
    const fid = `followup-${uid}`, rid = `end-r-${uid}`, nid = `end-n-${uid}`
    setNodes(nds => [...nds,
      { id: fid, type: NODE.FOLLOWUP, position: { x, y: 80 }, data: { wait_duration: 2, wait_unit: 'days', message_mode: 'ai', instructions: '', monday_status_column_id: '', monday_status_label: '' } },
      { id: rid, type: NODE.END, position: { x: x + 30, y: 700 }, data: { fixed: true } },
      { id: nid, type: NODE.END, position: { x: x + COL, y: 80 }, data: { fixed: false } },
    ])
    setEdges(eds => [...eds,
      decorate({ id: `er-${uid}`, source: fid, target: rid, sourceHandle: HANDLE.STOP }),
      decorate({ id: `en-${uid}`, source: fid, target: nid, sourceHandle: HANDLE.NEXT }),
    ])
  }

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const graph = { nodes: nodes.map(({ id: nid, type, position, data }) => ({ id: nid, type, position, data: strip(data) })), edges: edges.map(({ id: eid, source, target, sourceHandle }) => ({ id: eid, source, target, sourceHandle: sourceHandle || null })) }
      const errs = validateGraph(graph)
      if (errs.length) { setError(errs[0]); setSaving(false); return }
      const { stages } = flattenGraphToStages(graph)

      await fetchWithWorkspace(`/api/scenarios/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          enable_business_hours: win.enabled, followup_days: win.days, followup_start_time: win.start, followup_end_time: win.end, followup_timezone: win.tz,
          followup_graph: graph,
        }),
      }).catch(() => {})
      const res = await apiPost(`/api/scenarios/${id}/followup-stages`, { stages })
      const data = await res.json()
      if (data.success) { setSavedTick(true); setTimeout(() => setSavedTick(false), 2000) }
      else setError(data.error || 'Failed to save sequence')
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#E3E1DB] bg-white shrink-0">
        <button onClick={() => router.push('/scenarios')} title="Back" className="p-2 -ml-1 rounded-lg text-[#5C5A55] hover:bg-[#F7F6F3]">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[#D63B1F] flex items-center justify-center shrink-0"><i className="fas fa-layer-group text-white text-xs" /></span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-[#131210] leading-tight truncate">Follow-up sequence</p>
            <p className="text-[11px] text-[#9B9890] leading-tight truncate">{scenarioName}</p>
          </div>
        </div>
        <button onClick={() => router.push('/scenarios')} className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3]">Back</button>
        <button onClick={save} disabled={saving || loading} className="px-5 py-2 text-sm font-medium text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : savedTick ? <><i className="fas fa-check mr-1.5" />Saved</> : 'Save sequence'}
        </button>
      </div>

      {/* Rule banner */}
      <div className="flex gap-2.5 items-center px-5 py-2.5 bg-[#FBF3F1] border-b border-[rgba(214,59,31,0.14)] shrink-0">
        <i className="fas fa-circle-info text-[#D63B1F] text-sm"></i>
        <p className="text-xs text-[#5C5A55]">These messages send <span className="font-semibold text-[#131210]">only if the lead hasn’t replied</span>. The moment they reply, every follow-up stops and your AI takes over.</p>
      </div>

      {/* Working hours */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 bg-white border-b border-[#E3E1DB] shrink-0">
          <label className="flex items-center gap-2 text-xs font-medium text-[#131210] cursor-pointer">
            <button type="button" role="switch" aria-checked={win.enabled} onClick={() => setWin(w => ({ ...w, enabled: !w.enabled }))}
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${win.enabled ? 'bg-[#D63B1F]' : 'bg-[#D4D1C9]'}`}>
              <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${win.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            Only send during working hours
          </label>
          {win.enabled ? (
            <>
              <div className="flex items-center gap-1">
                {DAYS.map((d, i) => (
                  <button key={i} type="button" onClick={() => setWin(w => ({ ...w, days: w.days.includes(d.n) ? w.days.filter(x => x !== d.n) : [...w.days, d.n].sort((a, b) => a - b) }))}
                    className={`w-7 h-7 rounded-md text-xs font-semibold transition-colors ${win.days.includes(d.n) ? 'bg-[#D63B1F] text-white' : 'bg-[#F1EFEA] text-[#9B9890] hover:text-[#5C5A55]'}`}>{d.l}</button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#5C5A55]">
                <input type="time" value={win.start} onChange={e => setWin(w => ({ ...w, start: e.target.value }))} className={inputCls} />
                <span>to</span>
                <input type="time" value={win.end} onChange={e => setWin(w => ({ ...w, end: e.target.value }))} className={inputCls} />
              </div>
              <select value={win.tz} onChange={e => setWin(w => ({ ...w, tz: e.target.value }))} className={inputCls}>
                {TIMEZONES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </>
          ) : <span className="text-xs text-[#9B9890]">Follow-ups send 24/7. Turn on to limit to specific days &amp; hours.</span>}
        </div>
      )}

      {error && <div className="px-5 py-2 text-xs bg-[rgba(214,59,31,0.07)] border-b border-[rgba(214,59,31,0.16)] text-[#D63B1F] shrink-0">{error}</div>}

      {/* Canvas */}
      <div className="flex-1 relative" style={{ background: '#FAF9F6' }}>
        {loading ? (
          <div className="h-full flex items-center justify-center text-[#9B9890]"><i className="fas fa-spinner fa-spin text-xl" /></div>
        ) : (
          <>
            <ReactFlow nodes={rfNodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
              nodeTypes={followUpNodeTypes} fitView fitViewOptions={{ maxZoom: 1, padding: 0.2 }} proOptions={{ hideAttribution: true }}>
              <Background color="#E0DED7" gap={18} />
              <Controls />
              <MiniMap pannable zoomable style={{ background: '#FAFAF8' }} nodeColor="#F5C4C0" />
            </ReactFlow>
            {/* Add block */}
            <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 5 }}>
              <button onClick={() => setShowAdd(v => !v)} className="inline-flex items-center gap-2 bg-white border border-[#E3E1DB] text-[#131210] font-semibold text-sm px-3.5 py-2 rounded-lg hover:bg-[#F7F6F3]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <span className="w-4 h-4 rounded bg-[#D63B1F] text-white inline-flex items-center justify-center text-[13px] leading-none">+</span> Add block
                <svg className={`w-3.5 h-3.5 text-[#9B9890] transition-transform ${showAdd ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
              </button>
              {showAdd && (
                <div className="mt-1.5 w-56 bg-white border border-[#E3E1DB] rounded-lg shadow-xl py-1">
                  <button onClick={() => addNode(NODE.FOLLOWUP)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#F7F6F3]">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#D63B1F]" /><span className="text-sm font-medium text-[#131210]">Add follow-up</span>
                  </button>
                  <button onClick={() => addNode(NODE.END)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#F7F6F3]">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#16A34A]" /><span className="text-sm font-medium text-[#131210]">End</span>
                  </button>
                </div>
              )}
            </div>
            {/* legend */}
            <div style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 5 }} className="flex gap-3 items-center bg-white/90 border border-[#E8E8E4] rounded px-2.5 py-1.5 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1.5 text-[#5a5a57]"><span style={{ width: 14, height: 3, borderRadius: 2, background: '#D63B1F' }} />if no reply</span>
              <span className="inline-flex items-center gap-1.5 text-[#5a5a57]"><span style={{ width: 14, height: 3, borderRadius: 2, background: '#16A34A' }} />if replied → ends</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
