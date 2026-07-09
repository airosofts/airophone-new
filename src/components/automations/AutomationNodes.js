'use client'
import { Handle, Position } from '@xyflow/react'

// AiroPhone palette (matches AutomationBuilder cards).
const C = {
  trigger: { line: '#6161FF', head: '#EEEEFF', text: '#4B4ACF' },
  wait:    { line: '#2563EB', head: '#EAF1FE', text: '#1D4ED8' },
  send:    { line: '#D63B1F', head: '#FDEDEA', text: '#B5301A' },
  sync:    { line: '#16A34A', head: '#E9F7EF', text: '#15803D' },
}
const W = 250
const card = (line) => ({ background: '#fff', border: `2px solid ${line}`, borderRadius: 4, width: W, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', fontSize: 12, color: '#1A1816', position: 'relative' })
const head = (c, label, icon) => (
  <div style={{ background: c.head, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, borderTopLeftRadius: 2, borderTopRightRadius: 2 }}>
    <span>{icon}</span>
    <span style={{ fontWeight: 700, color: c.text, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
  </div>
)
const lbl = { fontSize: 10, fontWeight: 700, color: '#737370', textTransform: 'uppercase', display: 'block', margin: '0 0 3px' }
const inp = { width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 4, border: '1px solid #E8E8E4', outline: 'none', boxSizing: 'border-box' }
const dot = (bg) => ({ width: 9, height: 9, background: bg, border: '2px solid #fff' })
const Del = ({ id, onDelete }) => onDelete ? (
  <button onClick={() => onDelete(id)} title="Remove block"
    style={{ position: 'absolute', top: -9, right: -9, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#D63B1F', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: '20px', zIndex: 5 }}>&times;</button>
) : null

const TRIGGER_EVENTS = [['create_item', 'New item created'], ['change_column_value', 'Column changed'], ['move_item_to_group', 'Moved to group']]

export function TriggerNode({ id, data }) {
  const c = C.trigger
  const boards = data.boards || []
  const columns = data.columns || []
  return (
    <div style={card(c.line)}>
      {head(c, 'When this happens', '⚡')}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <label style={lbl}>Monday board</label>
          <select className="nodrag" style={inp} value={data.board_id || ''} onChange={(e) => { const b = boards.find(x => String(x.id) === e.target.value); data.onChange(id, { board_id: e.target.value, board_name: b?.name || null }) }}>
            <option value="">Select a board…</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Trigger</label>
          <select className="nodrag" style={inp} value={data.trigger_event || 'create_item'} onChange={(e) => data.onChange(id, { trigger_event: e.target.value })}>
            {TRIGGER_EVENTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Phone number column</label>
          <select className="nodrag" style={inp} value={data.phone_column_id || ''} onChange={(e) => data.onChange(id, { phone_column_id: e.target.value })} disabled={!data.board_id}>
            <option value="">{data.board_id ? 'Select a column…' : 'Pick a board first'}</option>
            {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
          </select>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={dot(c.line)} />
    </div>
  )
}

export function WaitNode({ id, data }) {
  const c = C.wait
  return (
    <div style={card(c.line)}>
      <Del id={id} onDelete={data.onDelete} />
      <Handle type="target" position={Position.Left} style={dot(c.line)} />
      {head(c, 'When to send', '⏱')}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="nodrag" type="number" min="0" style={{ ...inp, width: 80 }}
            value={Math.floor((data.send_delay_seconds || 0) / (data._unitDivisor || 60))}
            onChange={(e) => data.onChange(id, { send_delay_seconds: Number(e.target.value) * (data._unitDivisor || 60) })} />
          <select className="nodrag" style={inp} value={String(data._unitDivisor || 60)}
            onChange={(e) => data.onChange(id, { _unitDivisor: Number(e.target.value) })}>
            <option value="60">Minutes</option>
            <option value="3600">Hours</option>
            <option value="86400">Days</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Business hours</label>
          <select className="nodrag" style={inp} value={data.business_hours_mode || 'anytime'} onChange={(e) => data.onChange(id, { business_hours_mode: e.target.value })}>
            <option value="anytime">Send any time</option>
            <option value="within">Only within business hours</option>
            <option value="outside">Only outside business hours</option>
          </select>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={dot(c.line)} />
    </div>
  )
}

export function SendNode({ id, data }) {
  const c = C.send
  const numbers = data.phoneNumbers || []
  const mode = data.message_mode || 'template'
  return (
    <div style={{ ...card(c.line), width: 290 }}>
      <Del id={id} onDelete={data.onDelete} />
      <Handle type="target" position={Position.Left} style={dot(c.line)} />
      {head(c, 'Send a text', '💬')}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <label style={lbl}>Sender number</label>
          <select className="nodrag" style={inp} value={data.sender_phone_number_id || ''} onChange={(e) => data.onChange(id, { sender_phone_number_id: e.target.value })}>
            <option value="">Select a number…</option>
            {numbers.map(n => <option key={n.id} value={n.id}>{n.phone_number || n.number}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="nodrag" onClick={() => data.onChange(id, { message_mode: 'template' })}
            style={{ flex: 1, padding: '6px', borderRadius: 4, border: `1px solid ${mode === 'template' ? c.line : '#E8E8E4'}`, background: mode === 'template' ? c.head : '#fff', color: mode === 'template' ? c.text : '#737370', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>Template</button>
          <button className="nodrag" onClick={() => data.onChange(id, { message_mode: 'ai' })}
            style={{ flex: 1, padding: '6px', borderRadius: 4, border: `1px solid ${mode === 'ai' ? c.line : '#E8E8E4'}`, background: mode === 'ai' ? c.head : '#fff', color: mode === 'ai' ? c.text : '#737370', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>AI-written</button>
        </div>
        {mode === 'template' ? (
          <textarea className="nodrag" style={{ ...inp, minHeight: 70, resize: 'vertical' }} placeholder="Hi {{first_name}}, thanks for your interest!" value={data.message_template || ''} onChange={(e) => data.onChange(id, { message_template: e.target.value })} />
        ) : (
          <textarea className="nodrag" style={{ ...inp, minHeight: 70, resize: 'vertical' }} placeholder="Describe what the AI should say…" value={data.ai_instructions || ''} onChange={(e) => data.onChange(id, { ai_instructions: e.target.value })} />
        )}
      </div>
      <Handle type="source" position={Position.Right} style={dot(c.line)} />
    </div>
  )
}

export function SyncNode({ id, data }) {
  const c = C.sync
  return (
    <div style={card(c.line)}>
      <Del id={id} onDelete={data.onDelete} />
      <Handle type="target" position={Position.Left} style={dot(c.line)} />
      {head(c, 'Sync back to Monday', '🔁')}
      <div style={{ padding: '8px 10px', fontSize: 11, color: '#737370' }}>
        Two-way sync — configure the columns to update on sent / reply / done in the panel below the canvas.
      </div>
    </div>
  )
}

export const nodeTypes = { trigger: TriggerNode, wait: WaitNode, send: SendNode, sync: SyncNode }
