'use client'
import { Handle, Position } from '@xyflow/react'
import { HANDLE } from '@/lib/followup-graph'

// Palette matches the current follow-up cards: trigger blue, follow-up red, end green.
const ACCENT = { trigger: '#2563EB', followup: '#D63B1F', end: '#16A34A' }
const inputCls = 'w-full px-2.5 py-2 border border-[#D4D1C9] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]'
const labelCls = 'block text-[11px] font-semibold text-[#5C5A55] uppercase tracking-wide mb-1'
const dot = (bg) => ({ width: 11, height: 11, background: bg, border: '2px solid #fff' })

function Shell({ accent, badge, badgeBg, title, subtitle, width = 320, target, onDelete, id, children }) {
  return (
    <div className="group bg-white rounded-xl border border-[#E3E1DB] shadow-sm relative" style={{ width }}>
      {target && <Handle type="target" position={Position.Left} style={dot(accent)} />}
      {onDelete && (
        <button type="button" onClick={() => onDelete(id)} title="Remove block"
          className="nodrag absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full bg-[#D63B1F] text-white text-sm leading-6 text-center shadow z-10 hover:bg-[#c23119] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">&times;</button>
      )}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-t-xl border-b border-[#EFEDE8] cursor-grab active:cursor-grabbing" style={{ background: `${accent}0D` }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: badgeBg || accent, color: '#fff' }}>{badge}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#131210] leading-tight truncate">{title}</p>
          {subtitle && <p className="text-[11px] text-[#9B9890] leading-tight truncate">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="nodrag p-4 space-y-3">{children}</div>}
    </div>
  )
}

// Labelled output handle pinned to a vertical position on the right edge.
const OutHandle = ({ id, top, color, label }) => (
  <>
    <span className="nodrag" style={{ position: 'absolute', right: 16, top, transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, color, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{label}</span>
    <Handle type="source" id={id} position={Position.Right} style={{ ...dot(color), top }} />
  </>
)

export function TriggerNode() {
  return (
    <div className="bg-white rounded-xl border border-[#E3E1DB] shadow-sm relative" style={{ width: 260 }}>
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-t-xl border-b border-[#EFEDE8] cursor-grab active:cursor-grabbing" style={{ background: `${ACCENT.trigger}0D` }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: ACCENT.trigger, color: '#fff' }}><i className="fas fa-paper-plane text-xs" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#131210] leading-tight truncate">First message sent</p>
          <p className="text-[11px] text-[#9B9890] leading-tight truncate">Trigger</p>
        </div>
      </div>
      <div className="p-4">
        <p className="text-xs text-[#5C5A55] leading-relaxed">Your template or AI message goes out to the new lead. The sequence begins counting from here.</p>
      </div>
      <OutHandle id={HANDLE.START} top="70%" color={ACCENT.followup} label="if no reply ›" />
    </div>
  )
}

const UNITS = [['minutes', 'minutes'], ['hours', 'hours'], ['days', 'days'], ['weeks', 'weeks']]

export function FollowUpNode({ id, data }) {
  const ctx = data.ctx || {}
  const { onChange, onDelete, statusCols = [], multiBoard, index } = ctx
  const mode = data.message_mode === 'exact' ? 'exact' : 'ai'
  const selCol = statusCols.find(c => c.id === data.monday_status_column_id)
  return (
    <Shell accent={ACCENT.followup} badge={<span className="text-[11px] font-bold">{index ?? 1}</span>}
      title={`Follow-up ${index ?? 1}`} subtitle="Sent automatically if still no reply" width={360} target onDelete={onDelete} id={id}>
      <div>
        <label className={labelCls}>Wait</label>
        <div className="flex gap-2">
          <input type="number" min={1} value={data.wait_duration ?? 1}
            onChange={(e) => onChange(id, { wait_duration: parseInt(e.target.value) || 1 })}
            className="w-20 px-2.5 py-2 border border-[#D4D1C9] rounded-md text-sm text-center bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]" />
          <select value={data.wait_unit || 'days'} onChange={(e) => onChange(id, { wait_unit: e.target.value })} className={inputCls}>
            {UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div>
        <div className="flex gap-1 p-1 bg-[#F1EFEA] rounded-lg mb-2">
          {[['ai', '✨ AI writes it'], ['exact', 'Send exact message']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => onChange(id, { message_mode: v })}
              className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === v ? 'bg-white text-[#131210] shadow-sm' : 'text-[#9B9890] hover:text-[#5C5A55]'}`}>{l}</button>
          ))}
        </div>
        <textarea rows={4} value={data.instructions || ''} onChange={(e) => onChange(id, { instructions: e.target.value })}
          placeholder={mode === 'exact' ? 'The exact text to send, e.g. “Hey {{first_name}}, just checking in.”' : 'Describe what this message should do — the AI writes it. e.g. “Light, friendly bump. Re-ask for a day/time.”'}
          className={`${inputCls} resize-none`} />
        <p className="text-[11px] text-[#9B9890] mt-1">{mode === 'exact' ? 'Sent word-for-word. Tokens like {{first_name}} are filled in.' : 'The AI writes a fresh message in your scenario’s voice.'}</p>
      </div>
      <div className="pt-2 border-t border-[#EFEDE8]">
        <label className={labelCls}>Set Monday status <span className="text-[#9B9890] font-normal normal-case">(optional)</span></label>
        {statusCols.length === 0 ? (
          <p className="text-[11px] text-[#9B9890]">Add a Monday automation on this scenario’s line (with a status column) to set a status here.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select value={data.monday_status_column_id || ''} onChange={(e) => onChange(id, { monday_status_column_id: e.target.value, monday_status_label: '' })} className={`${inputCls} flex-1 min-w-[130px]`}>
              <option value="">— No status —</option>
              {statusCols.map(c => <option key={c.id} value={c.id}>{multiBoard ? `${c.board_name} · ${c.title}` : c.title}</option>)}
            </select>
            {selCol && (
              <>
                <span className="text-xs text-[#9B9890]">to</span>
                <select value={data.monday_status_label || ''} onChange={(e) => onChange(id, { monday_status_label: e.target.value })} className={`${inputCls} flex-1 min-w-[130px]`}>
                  <option value="">— Choose a label —</option>
                  {selCol.labels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </>
            )}
          </div>
        )}
      </div>
      {/* branches */}
      <OutHandle id={HANDLE.NEXT} top="62%" color={ACCENT.followup} label="if no reply ›" />
      <OutHandle id={HANDLE.STOP} top="82%" color={ACCENT.end} label="if replied ›" />
    </Shell>
  )
}

export function EndNode({ id, data }) {
  const ctx = data.ctx || {}
  const fixed = !!data.fixed   // fixed = the replied→End (engine reply-stop); removable = the no-reply tail
  return (
    <div className="group bg-white rounded-xl border border-[#E3E1DB] shadow-sm relative" style={{ width: 240 }}>
      <Handle type="target" position={Position.Left} style={dot(ACCENT.end)} />
      {!fixed && ctx.onDelete && (
        <button type="button" onClick={() => ctx.onDelete(id)} title="Remove — then connect a follow-up to “if no reply”"
          className="nodrag absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full bg-[#D63B1F] text-white text-sm leading-6 text-center shadow z-10 hover:bg-[#c23119] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">&times;</button>
      )}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-t-xl border-b border-[#EFEDE8]" style={{ background: `${ACCENT.end}0D` }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: ACCENT.end, color: '#fff' }}><i className="fas fa-check text-xs" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#131210] leading-tight truncate">{fixed ? 'Lead replies → ends' : 'End'}</p>
          <p className="text-[11px] text-[#9B9890] leading-tight truncate">{fixed ? 'AI takes over' : 'No reply → ends here'}</p>
        </div>
        {fixed && <i className="fas fa-lock text-[10px] text-[#B5B2AA]" title="Built-in — a reply always ends the sequence, so this can’t be removed" />}
      </div>
      <div className="p-4"><p className="text-xs text-[#5C5A55] leading-relaxed">
        {fixed
          ? 'As soon as the lead responds, remaining follow-ups are cancelled and your AI scenario takes over. This is built into the engine and can’t be removed.'
          : 'The sequence ends here if the lead never replies. Remove this (×) to continue with another follow-up on the “if no reply” branch.'}
      </p></div>
    </div>
  )
}

export const followUpNodeTypes = { trigger: TriggerNode, followup: FollowUpNode, end: EndNode }
