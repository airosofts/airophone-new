'use client'
import { Handle, Position } from '@xyflow/react'
import SearchableDropdown from '@/components/SearchableDropdown'

// AiroPhone palette (matches the original automation cards).
const ACCENT = { trigger: '#6161FF', send: '#D63B1F', wait: '#2563EB', sync: '#16A34A' }

const inputCls = 'w-full px-3 py-2.5 border border-[#D4D1C9] rounded-lg text-sm bg-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]'
const labelCls = 'block text-sm font-medium text-[#5C5A55] mb-1.5'
const roCls = 'px-3 py-2.5 border border-[#E3E1DB] rounded-lg text-sm bg-[#F7F6F3] text-[#5C5A55]'

const TRIGGER_LABELS = {
  create_item: 'New item created',
  change_column_value: 'A column value changes',
  move_item_to_group: 'Item moved to a group',
}

const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86400 }
function secondsToUnit(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0))
  if (n === 0) return 'minutes'
  if (n % UNIT_SECONDS.days === 0) return 'days'
  if (n % UNIT_SECONDS.hours === 0) return 'hours'
  return 'minutes'
}

const phoneOf = (p) => p?.phone_number || p?.phoneNumber || ''
const nameOf = (p) => p?.custom_name || p?.prefix || ''

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

// ── Node shell ──────────────────────────────────────────────────────────────
// Header is the drag handle; the body is `nodrag` so every form control inside
// works without the canvas hijacking the pointer. Handles are the manual
// connection points (drag source→target to wire blocks).
const handleStyle = (bg) => ({ width: 11, height: 11, background: bg, border: '2px solid #fff' })

function NodeShell({ accent, badge, badgeBg, title, subtitle, width = 340, target, source, onDelete, id, children }) {
  return (
    <div className="group bg-white rounded-xl border border-[#E3E1DB] shadow-sm relative" style={{ width }}>
      {target && <Handle type="target" position={Position.Left} style={handleStyle(accent)} />}
      {onDelete && (
        <button type="button" onClick={() => onDelete(id)} title="Remove block"
          className="nodrag absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full bg-[#D63B1F] text-white text-sm leading-6 text-center shadow z-10 hover:bg-[#c23119] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
          &times;
        </button>
      )}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-t-xl border-b border-[#EFEDE8] cursor-grab active:cursor-grabbing" style={{ background: `${accent}0D` }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
          style={{ background: badgeBg || accent, borderColor: badgeBg ? '#E3E1DB' : 'transparent' }}>
          {badge}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#131210] leading-tight truncate">{title}</p>
          {subtitle && <p className="text-[11px] text-[#9B9890] leading-tight truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="nodrag p-4 space-y-3">{children}</div>
      {source && <Handle type="source" position={Position.Right} style={handleStyle(accent)} />}
    </div>
  )
}

// ── Writeback editors (moved here so they live inside the Sync node) ─────────
// Monday: status / date / text columns. "Change [column] to [value]".
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

// Sheets: everything is text, so just "Change [column] to [value]".
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

// ── 1. Trigger — Monday board (source of the flow) ──────────────────────────
export function TriggerNode({ id, data }) {
  const ctx = data.ctx || {}
  const {
    isEdit, isSheets, onChange,
    boards = [], columns = [], loadingBoards, loadingColumns,
    spreadsheets = [], tabs = [], sheetColumns = [], loadingSheets = {},
  } = ctx

  // ── Google Sheets trigger — new row in a tab ──────────────────────────────
  if (isSheets) {
    const phoneColLabel = sheetColumns.find(c => c.id === data.phone_column)?.title
    return (
      <NodeShell accent={ACCENT.sync} badgeBg="#FFFFFF" badge={<SheetsLogo size={16} />}
        title="When this happens" subtitle="Trigger — new row in a Google Sheet" width={340} source>
        <div>
          <label className={labelCls}>Spreadsheet *</label>
          {isEdit ? (
            <div className={roCls}>{data.spreadsheet_name || data.spreadsheet_id}</div>
          ) : (
            <SearchableDropdown
              value={data.spreadsheet_id || ''}
              onChange={(v) => { const s = spreadsheets.find(x => String(x.id) === String(v)); onChange(id, { spreadsheet_id: v, spreadsheet_name: s?.name || '', sheet_id: null, sheet_name: '', phone_column: '' }) }}
              options={spreadsheets.map(s => ({ value: String(s.id), label: s.name, searchText: s.name }))}
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
            <div className={roCls}>{data.sheet_name || '—'}</div>
          ) : data.spreadsheet_id ? (
            <SearchableDropdown
              value={data.sheet_name || ''}
              onChange={(v) => { const t = tabs.find(x => x.title === v); onChange(id, { sheet_name: v, sheet_id: t?.id ?? null, phone_column: '' }) }}
              options={tabs.map(t => ({ value: t.title, label: t.title, searchText: t.title }))}
              placeholder={loadingSheets.tabs ? 'Loading tabs…' : 'Select a tab'}
              loading={loadingSheets.tabs}
              renderSelected={(o) => o.label}
              renderOption={(o) => <p className="text-sm text-[#131210]">{o.label}</p>}
            />
          ) : (
            <div className="px-3 py-2.5 border border-dashed border-[#D4D1C9] rounded-lg text-sm bg-[#F7F6F3] text-[#9B9890]">Pick a spreadsheet first</div>
          )}
        </div>
        <p className="text-[11px] text-[#9B9890]">Fires when a <b>new row</b> (a new phone number) is added to this tab. Rows already there when you save are ignored.</p>
        <div>
          <label className={labelCls}>Phone number column *</label>
          {isEdit ? (
            <div className={roCls}>{phoneColLabel || data.phone_column || '—'}</div>
          ) : data.sheet_name ? (
            <SearchableDropdown
              value={data.phone_column || ''}
              onChange={(v) => onChange(id, { phone_column: v })}
              options={sheetColumns.map(c => ({ value: c.id, label: c.title || `Column ${c.id}`, type: `Column ${c.id}`, searchText: `${c.title} ${c.id}` }))}
              placeholder={loadingSheets.columns ? 'Loading columns…' : 'Select the phone column'}
              loading={loadingSheets.columns}
              renderSelected={(o) => o.label}
              renderOption={(o) => (
                <div>
                  <p className="text-sm text-[#131210]">{o.label}</p>
                  <p className="text-xs text-[#9B9890] font-mono mt-0.5">{o.type}</p>
                </div>
              )}
            />
          ) : (
            <div className="px-3 py-2.5 border border-dashed border-[#D4D1C9] rounded-lg text-sm bg-[#F7F6F3] text-[#9B9890]">Pick a tab first</div>
          )}
        </div>
        {isEdit && (
          <p className="text-[11px] text-[#9B9890]">Spreadsheet and tab are locked after creation — the baseline of existing rows is bound to them. To change either, create a new automation.</p>
        )}
      </NodeShell>
    )
  }

  // ── Monday trigger — board event ──────────────────────────────────────────
  return (
    <NodeShell accent={ACCENT.trigger} badgeBg="#FFFFFF" badge={<MondayLogo size={16} />}
      title="When this happens" subtitle="Trigger — Monday board" width={340} source>
      <div>
        <label className={labelCls}>Monday board *</label>
        {isEdit ? (
          <div className={roCls}>{data.board_name || data.board_id}</div>
        ) : (
          <SearchableDropdown
            value={data.board_id || ''}
            onChange={(v) => { const b = boards.find(x => String(x.id) === String(v)); onChange(id, { board_id: v, board_name: b?.name || '', phone_column_id: '' }) }}
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
          <div className={roCls}>{TRIGGER_LABELS[data.trigger_event] || data.trigger_event || 'New item created'}</div>
        ) : (
          <select className={inputCls} value={data.trigger_event || 'create_item'} onChange={(e) => onChange(id, { trigger_event: e.target.value })}>
            {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
      {isEdit && (
        <p className="text-[11px] text-[#9B9890]">Board and trigger are locked because the Monday webhook is bound to them. To change either, delete this automation and create a new one.</p>
      )}
      <div>
        <label className={labelCls}>Phone number column *</label>
        {data.board_id ? (
          <SearchableDropdown
            value={data.phone_column_id || ''}
            onChange={(v) => onChange(id, { phone_column_id: v })}
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
    </NodeShell>
  )
}

// ── 2. Send a text ──────────────────────────────────────────────────────────
export function SendNode({ id, data }) {
  const ctx = data.ctx || {}
  const { phoneNumbers = [], placeholderCols = [], placeholderSeed = 'item_name', onChange, onDelete } = ctx
  const mode = data.message_mode || 'template'
  return (
    <NodeShell accent={ACCENT.send} badge={<i className="fas fa-comment-dots text-white text-xs" />}
      title="Send a text" subtitle="SMS to the new lead" width={440} target source onDelete={onDelete} id={id}>
      <div>
        <label className={labelCls}>Sender number *</label>
        <SearchableDropdown
          value={data.sender_phone_number_id || ''}
          onChange={(v) => onChange(id, { sender_phone_number_id: v })}
          options={phoneNumbers.map(p => { const num = phoneOf(p), nm = nameOf(p); return { value: String(p.id), name: nm, number: num, searchText: `${nm} ${num}` } })}
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
            <button key={v} type="button" onClick={() => onChange(id, { message_mode: v })}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-md border transition-colors ${mode === v ? 'bg-[#fdecea] border-[#D63B1F] text-[#D63B1F]' : 'bg-[#FFFFFF] border-[#E3E1DB] text-[#5C5A55] hover:bg-[#F7F6F3]'}`}>
              {l}
            </button>
          ))}
        </div>
        {mode === 'template' ? (
          <>
            <textarea className={`${inputCls} resize-y min-h-[100px]`} value={data.message_template || ''}
              placeholder="Hi {{first_name}}, thanks for your interest! …"
              onChange={(e) => onChange(id, { message_template: e.target.value })} />
            {placeholderCols.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-[11px] text-[#9B9890]">Placeholders:</span>
                {[...new Set([placeholderSeed, ...placeholderCols.map(c => c.placeholder).filter(Boolean)])].map(p => (
                  <button key={p} type="button"
                    onClick={() => onChange(id, { message_template: (data.message_template || '') + `{{${p}}}` })}
                    className="px-2 py-0.5 text-[11px] font-mono bg-[#EFEDE8] text-[#5C5A55] rounded border border-[#E3E1DB] hover:text-[#D63B1F]">
                    {`{{${p}}}`}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <textarea className={`${inputCls} resize-y min-h-[100px]`} value={data.ai_instructions || ''}
              placeholder="Write a warm opening text introducing our home-buying offer and asking if they'd like a cash quote…"
              onChange={(e) => onChange(id, { ai_instructions: e.target.value })} />
            <p className="text-[11px] text-[#9B9890] mt-1.5">The AI writes a unique opening message per lead, using their board details.</p>
          </>
        )}
      </div>
    </NodeShell>
  )
}

// ── 3. When to send — delay & business hours ────────────────────────────────
export function WaitNode({ id, data }) {
  const ctx = data.ctx || {}
  const { onChange, onDelete } = ctx
  const unit = data.delay_unit || secondsToUnit(data.send_delay_seconds)
  const unitSec = UNIT_SECONDS[unit] || 60
  const amount = Math.floor((Number(data.send_delay_seconds) || 0) / unitSec)
  const bh = data.business_hours_mode || 'anytime'
  return (
    <NodeShell accent={ACCENT.wait} badge={<i className="fas fa-clock text-white text-xs" />}
      title="When to send" subtitle="Delay & business hours" width={320} target source onDelete={onDelete} id={id}>
      <div>
        <label className={labelCls}>Send delay</label>
        <div className="flex gap-2">
          <input type="number" min={0} max={999} value={amount}
            onChange={(e) => onChange(id, { send_delay_seconds: Math.max(0, Math.floor(Number(e.target.value) || 0)) * unitSec, delay_unit: unit })}
            className="w-24 shrink-0 px-3 py-2.5 border border-[#D4D1C9] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]" />
          <select value={unit}
            onChange={(e) => onChange(id, { delay_unit: e.target.value, send_delay_seconds: amount * (UNIT_SECONDS[e.target.value] || 60) })}
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
        <select value={bh} onChange={(e) => onChange(id, { business_hours_mode: e.target.value })}
          className="w-full px-3 py-2.5 border border-[#D4D1C9] rounded-lg bg-white text-sm text-[#131210]">
          <option value="anytime">Send any time</option>
          <option value="within">Only within business hours</option>
          <option value="outside">Only outside business hours</option>
        </select>
        <p className="text-[11px] text-[#9B9890] mt-1">
          {bh === 'within'
            ? 'Sends are held until the next time inside your business hours.'
            : bh === 'outside'
            ? 'Sends are held until outside your business hours (before open / after close).'
            : 'No time restriction — sends go out as soon as they’re due.'}
          {' '}Configure the schedule in <a href="/settings?section=business-hours" className="text-[#D63B1F] hover:underline">Settings → Business Hours</a>.
        </p>
      </div>
    </NodeShell>
  )
}

// ── 4. Sync back — two-way writeback (config lives inside the node) ──────────
export function SyncNode({ id, data }) {
  const ctx = data.ctx || {}
  const { onDelete } = ctx
  const wb = ctx.wb || {}
  const isSheets = wb.isSheets
  const ready = isSheets ? !!wb.selSheetName : !!wb.selBoardId
  return (
    <NodeShell accent={ACCENT.sync} badge={<i className="fas fa-rotate text-white text-xs" />}
      title={isSheets ? 'Sync back to the sheet' : 'Sync back to Monday'} subtitle="Two-way sync — optional"
      width={400} target onDelete={onDelete} id={id}>
      {!ready ? (
        <div className="px-3 py-2.5 border border-dashed border-[#D4D1C9] rounded-lg text-sm bg-[#F7F6F3] text-[#9B9890]">
          {isSheets ? 'Pick a sheet tab first' : 'Pick a board first'}
        </div>
      ) : isSheets ? (
        <>
          <SheetEventEditor title="When the first message is sent"
            hint="Written the moment the AI/template goes out — e.g. Status = AI Engaged."
            columns={wb.sheetColumns} col={wb.sentCol} setCol={wb.setSentCol} value={wb.sentText} setValue={wb.setSentText} />
          <div className="border-t border-[#EFEDE8] pt-3 mt-3">
            <SheetEventEditor title="When a lead replies"
              hint="Written on every inbound message — e.g. Status = Replied."
              columns={wb.sheetColumns} col={wb.replyCol} setCol={wb.setReplyCol} value={wb.replyText} setValue={wb.setReplyText} />
          </div>
          <div className="border-t border-[#EFEDE8] pt-3 mt-3">
            <SheetEventEditor title="When marked done"
              hint="Written when you toggle the chat to Done / Closed."
              columns={wb.sheetColumns} col={wb.doneCol} setCol={wb.setDoneCol} value={wb.doneText} setValue={wb.setDoneText} />
          </div>
          <p className="text-[11px] text-[#9B9890] mt-2">Tip: write <span className="font-mono">{'{{date}}'}</span> to stamp today&rsquo;s date (e.g. a &ldquo;Last Contacted&rdquo; column).</p>
        </>
      ) : (
        <>
          <EventEditor title="When the first message is sent"
            hint="Set the moment the AI/template goes out — e.g. Status = AI Engaged / Template Sent."
            columns={wb.columns} colId={wb.sentCol} setColId={wb.setSentCol}
            valueLabel={wb.sentLabel} setValueLabel={wb.setSentLabel} valueText={wb.sentText} setValueText={wb.setSentText} />
          <div className="border-t border-[#EFEDE8] pt-3 mt-3">
            <EventEditor title="When a lead replies"
              hint="Set on every inbound message — e.g. Status = Replied / Engaged."
              columns={wb.columns} colId={wb.replyCol} setColId={wb.setReplyCol}
              valueLabel={wb.replyLabel} setValueLabel={wb.setReplyLabel} valueText={wb.replyText} setValueText={wb.setReplyText} />
          </div>
          <div className="border-t border-[#EFEDE8] pt-3 mt-3">
            <EventEditor title="When marked done"
              hint="Set when you toggle the chat to Done / Closed."
              columns={wb.columns} colId={wb.doneCol} setColId={wb.setDoneCol}
              valueLabel={wb.doneLabel} setValueLabel={wb.setDoneLabel} valueText={wb.doneText} setValueText={wb.setDoneText} />
          </div>
        </>
      )}
    </NodeShell>
  )
}

export const nodeTypes = { trigger: TriggerNode, wait: WaitNode, send: SendNode, sync: SyncNode }
