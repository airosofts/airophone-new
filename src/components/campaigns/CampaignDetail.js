'use client'

// The right-panel view for an EXISTING campaign in the campaigns workspace:
// a polished, full breakdown — status, visible action buttons, send progress,
// an SMS preview, audience/schedule/pace, every stored field, and the recipients.
import { useState, useEffect } from 'react'
import { fetchWithWorkspace } from '@/lib/api-client'

const post = (url, body) => fetchWithWorkspace(url, { method: 'POST', body: JSON.stringify(body || {}) })
const del = (url) => fetchWithWorkspace(url, { method: 'DELETE' })
const fmt = (d) => (d ? new Date(d).toLocaleString() : '—')
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']  // ISO 1–7
const fmtDays = (a) => (Array.isArray(a) && a.length ? a.map(d => DAYS[d]).filter(Boolean).join(', ') : null)
const fmtWindows = (w) => (Array.isArray(w) && w.length ? w.map(x => `${x.start}–${x.end}`).join(', ') : null)
const fmtDelay = (ms) => { const n = Number(ms) || 0; return n >= 1000 ? `${n / 1000}s` : `${n}ms` }

const STATUS = {
  draft: { label: 'Draft', cls: 'bg-[#EFEDE8] text-[#5C5A55]' },
  running: { label: 'Running', cls: 'bg-green-50 text-green-700' },
  sending: { label: 'Sending', cls: 'bg-green-50 text-green-700' },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700' },
  paused: { label: 'Paused', cls: 'bg-yellow-50 text-yellow-700' },
  completed: { label: 'Completed', cls: 'bg-blue-50 text-blue-700' },
  archived: { label: 'Archived', cls: 'bg-[#EFEDE8] text-[#5C5A55]' },
  failed: { label: 'Failed', cls: 'bg-red-50 text-red-700' },
}

function Section({ title, children, right }) {
  return (
    <div className="bg-white border border-[#E3E1DB] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#EFEDE8]">
        <p className="text-[11px] font-semibold text-[#9B9890] uppercase tracking-wide">{title}</p>
        {right}
      </div>
      {children}
    </div>
  )
}
function Row({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b border-[#F1EFEA] last:border-0">
      <span className="text-xs text-[#9B9890] shrink-0 w-36 pt-0.5">{label}</span>
      <span className={`text-sm text-[#131210] text-right flex-1 whitespace-pre-wrap break-words ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</span>
    </div>
  )
}
function Stat({ label, value, tint = '#131210' }) {
  return (
    <div className="bg-white border border-[#E3E1DB] rounded-xl px-4 py-3">
      <p className="text-[10px] font-semibold text-[#9B9890] uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-0.5" style={{ color: tint }}>{value}</p>
    </div>
  )
}
function Btn({ onClick, icon, label, variant = 'secondary', disabled }) {
  const cls = variant === 'primary' ? 'bg-[#D63B1F] hover:bg-[#c23119] text-white border-[#D63B1F]'
    : variant === 'danger' ? 'bg-white text-[#D63B1F] border-[#D63B1F] hover:bg-[#FBEAE7]'
      : 'bg-white text-[#5C5A55] border-[#E3E1DB] hover:bg-[#F7F6F3] hover:text-[#131210]'
  return (
    <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border rounded-lg transition-colors disabled:opacity-50 ${cls}`}>
      <i className={`fas ${icon} text-xs`} />{label}
    </button>
  )
}

export default function CampaignDetail({ campaign, onChanged, onDeleted, tabs = null, onNew }) {
  const [busy, setBusy] = useState('')
  const [recipients, setRecipients] = useState(null)
  const [loadingRec, setLoadingRec] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { setRecipients(null); setConfirmDelete(false) }, [campaign?.id])

  const c = campaign
  const st = STATUS[c.status] || { label: c.status, cls: 'bg-[#EFEDE8] text-[#5C5A55]' }
  const audience = c.source === 'monday' ? `Monday board · ${c.monday_board_name || '—'}`
    : c.source === 'sheets' ? `Google Sheet · ${c.sheet_name || '—'}`
      : `Contact lists · ${(c.contact_list_names || []).join(', ') || '—'}`
  const total = Number(c.total_recipients) || 0
  const sent = Number(c.sent_count) || 0
  const failed = Number(c.failed_count) || 0
  const pct = total ? Math.min(100, Math.round((sent / total) * 100)) : 0
  const running = c.status === 'running' || c.status === 'sending' || c.status === 'scheduled'

  const act = async (fn, key) => { setBusy(key); try { await fn() } catch {} finally { setBusy(''); onChanged?.() } }
  const launch = () => act(() => post(`/api/campaigns/${c.id}/start`), 'launch')
  const pause = () => act(() => post(`/api/campaigns/${c.id}/pause`, { is_paused: c.status !== 'paused' }), 'pause')
  const stop = () => act(() => post(`/api/campaigns/${c.id}/stop`), 'stop')
  const archive = () => act(() => post(`/api/campaigns/${c.id}/archive`, { is_archived: c.status !== 'archived' }), 'archive')
  const doDelete = async () => {
    setConfirmDelete(false); setBusy('delete')
    try { await del(`/api/campaigns/${c.id}`) } catch {} finally { setBusy(''); onDeleted?.() }
  }
  const viewRecipients = async () => {
    setLoadingRec(true)
    const r = await fetchWithWorkspace(`/api/campaigns/${c.id}/recipients`).then(x => x.json()).catch(() => ({}))
    setRecipients(r?.recipients || r?.data || [])
    setLoadingRec(false)
  }

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]" style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      {/* header: tabs + status/name + New */}
      <div className="flex items-center gap-3 px-5 py-2.5 bg-white border-b border-[#E3E1DB] shrink-0">
        {tabs}
        <div className="flex-1" />
        {onNew && (
          <button onClick={onNew} className="px-3 py-2 text-sm font-medium text-[#D63B1F] border border-[#D63B1F] rounded-lg hover:bg-[#FBEAE7] shrink-0">
            <i className="fas fa-plus text-xs mr-1" />New
          </button>
        )}
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-3xl mx-auto space-y-4">

          {/* title + status + created */}
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-bold text-[#131210] tracking-tight">{c.name}</h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.label}</span>
            </div>
            <p className="text-xs text-[#9B9890] mt-0.5">Created {fmt(c.created_at)}{busy && <span className="ml-2 text-[#D63B1F]">· {busy}…</span>}</p>
          </div>

          {/* action buttons */}
          <div className="flex flex-wrap gap-2">
            {c.status === 'draft' && <Btn onClick={launch} icon="fa-paper-plane" label="Launch campaign" variant="primary" disabled={!!busy} />}
            {running && <Btn onClick={pause} icon="fa-pause" label="Pause" disabled={!!busy} />}
            {c.status === 'paused' && <Btn onClick={pause} icon="fa-play" label="Resume" variant="primary" disabled={!!busy} />}
            {(running || c.status === 'paused') && <Btn onClick={stop} icon="fa-stop" label="Stop" disabled={!!busy} />}
            <Btn onClick={viewRecipients} icon="fa-users" label="View recipients" disabled={!!busy} />
            <Btn onClick={archive} icon="fa-box-archive" label={c.status === 'archived' ? 'Unarchive' : 'Archive'} disabled={!!busy} />
            <Btn onClick={() => setConfirmDelete(true)} icon="fa-trash" label="Delete" variant="danger" disabled={!!busy} />
          </div>

          {/* stats + progress */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Recipients" value={total} />
            <Stat label="Sent" value={sent} tint="#16A34A" />
            <Stat label="Failed" value={failed} tint={failed ? '#DC2626' : '#131210'} />
          </div>
          {total > 0 && (
            <div className="bg-white border border-[#E3E1DB] rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-1.5"><span className="text-[11px] font-semibold text-[#9B9890] uppercase tracking-wide">Send progress</span><span className="text-xs text-[#5C5A55]">{sent} / {total} · {pct}%</span></div>
              <div className="h-2 rounded-full bg-[#F1EFEA] overflow-hidden"><div className="h-full rounded-full bg-[#16A34A]" style={{ width: `${pct}%` }} /></div>
            </div>
          )}

          {/* message preview */}
          <Section title="Message">
            <div className="p-4">
              <div className="max-w-sm">
                <div className="bg-[#F5F5F2] border border-[#EFEDE8] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-[#131210] whitespace-pre-wrap">{c.message_template || '—'}</div>
                <p className="text-[11px] text-[#9B9890] mt-1.5">From {c.sender_number || '—'}</p>
              </div>
            </div>
          </Section>

          {/* audience */}
          <Section title="Audience">
            <Row label="Source" value={audience} />
            {(c.contact_list_names || []).length > 0 && <Row label="Contact lists" value={c.contact_list_names.join(', ')} />}
            <Row label="Engagement filter" value={c.recipient_filters?.engagement && c.recipient_filters.engagement !== 'all' ? c.recipient_filters.engagement.replace(/_/g, ' ') : 'Everyone'} />
            {c.recipient_filters?.skip_contacted_hours ? <Row label="Skip if texted within" value={`${c.recipient_filters.skip_contacted_hours}h`} /> : null}
          </Section>

          {/* schedule & pace */}
          <Section title="Schedule & pace">
            <Row label="Schedule" value={c.scheduled_at ? fmt(c.scheduled_at) : 'Send immediately'} />
            <Row label="Daily cap" value={c.daily_cap ? `${c.daily_cap} / day` : 'No cap'} />
            <Row label="Business hours" value={fmtWindows(c.send_windows) ? `${fmtWindows(c.send_windows)}${fmtDays(c.send_days) ? ` · ${fmtDays(c.send_days)}` : ''}${c.send_timezone ? ` · ${c.send_timezone}` : ''}` : 'Anytime'} />
            <Row label="Throttle" value={c.throttle_count ? `${c.throttle_count} per ${c.throttle_window_seconds || 0}s` : 'None'} />
            <Row label="Delay between texts" value={fmtDelay(c.delay_between_messages)} />
            <Row label="Recurring" value={c.recurring ? `Yes${c.cycle != null ? ` · cycle ${c.cycle}` : ''}` : 'No'} />
          </Section>

          {/* all fields */}
          <Section title="Details">
            <Row label="Status" value={st.label} />
            <Row label="Created" value={fmt(c.created_at)} />
            <Row label="Scheduled at" value={c.scheduled_at ? fmt(c.scheduled_at) : '—'} />
            <Row label="Started at" value={fmt(c.started_at)} />
            <Row label="Completed at" value={fmt(c.completed_at)} />
            <Row label="Total recipients" value={total} />
            <Row label="Sent" value={sent} />
            <Row label="Failed" value={failed} />
            <Row label="Campaign ID" value={c.id} mono />
          </Section>

          {/* recipients */}
          {(recipients || loadingRec) && (
            <Section title={`Recipients${recipients ? ` (${recipients.length})` : ''}`}>
              {loadingRec ? <p className="px-4 py-3 text-sm text-[#9B9890]">Loading…</p>
                : recipients.length === 0 ? <p className="px-4 py-3 text-sm text-[#9B9890]">No recipients yet.</p>
                  : (
                    <div className="max-h-80 overflow-y-auto">
                      {recipients.slice(0, 300).map((r, i) => (
                        <div key={r.id || i} className="flex items-center justify-between gap-2 px-4 py-2 text-sm border-b border-[#F1EFEA] last:border-0">
                          <span className="text-[#131210] truncate">{r.first_name || r.last_name ? `${r.first_name || ''} ${r.last_name || ''}`.trim() + ' · ' : ''}{r.to_number || r.phone || r.contact?.phone || '—'}</span>
                          <span className="text-[11px] text-[#9B9890] shrink-0">{r.status || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
            </Section>
          )}
        </div>
      </div>

      {/* Delete confirmation — styled in-app dialog (no native confirm) */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmDelete(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-[#FBEAE7] flex items-center justify-center shrink-0"><i className="fas fa-trash text-[#D63B1F] text-sm" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#131210]">Delete this campaign?</p>
                  <p className="text-xs text-[#5C5A55] mt-1 leading-relaxed">
                    <span className="font-medium text-[#131210]">{c.name}</span> will be permanently removed. This can&rsquo;t be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-[#FBFAF8] border-t border-[#E3E1DB]">
              <button onClick={() => setConfirmDelete(false)} className="px-3.5 py-2 text-sm font-medium text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3]">Cancel</button>
              <button onClick={doDelete} className="px-3.5 py-2 text-sm font-semibold text-white bg-[#D63B1F] hover:bg-[#c23119] rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
