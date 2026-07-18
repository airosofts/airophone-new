'use client'

// The right-panel view for an EXISTING ringless-voicemail campaign in the
// workspace: status, action buttons, live send progress, the audio, and every
// stored field. Sibling of CampaignDetail (the SMS detail is untouched). Actions
// call the RVM routes directly; while in-flight it polls the parent for fresh counts.
import { useState, useEffect, useCallback } from 'react'
import { fetchWithWorkspace } from '@/lib/api-client'

const post = (url, body) => fetchWithWorkspace(url, { method: 'POST', body: JSON.stringify(body || {}) })
const fmt = (d) => (d ? new Date(d).toLocaleString() : '—')
const hhmm = (t) => String(t || '').slice(0, 5)
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']   // ISO 1–7
const fmtDays = (a) => (Array.isArray(a) && a.length && a.length < 7 ? a.map(d => DAYS[d]).filter(Boolean).join(', ') : null)
const fmtWindows = (w) => (Array.isArray(w) && w.length ? w.map(x => `${hhmm(x.start)}–${hhmm(x.end)}`).join(', ') : null)

const STATUS = {
  draft: { label: 'Draft', cls: 'bg-[#EFEDE8] text-[#5C5A55]' },
  running: { label: 'Running', cls: 'bg-green-50 text-green-700' },
  paused: { label: 'Paused', cls: 'bg-yellow-50 text-yellow-700' },
  completed: { label: 'Completed', cls: 'bg-blue-50 text-blue-700' },
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

export default function VoicemailDetail({ campaign, contactLists = [], onChanged, onDeleted, onEdit, tabs = null, onNew }) {
  const [busy, setBusy] = useState('')
  const [recipients, setRecipients] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loadingRec, setLoadingRec] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { setRecipients(null); setSummary(null); setConfirmDelete(false) }, [campaign?.id])

  const c = campaign
  const st = STATUS[c.status] || { label: c.status, cls: 'bg-[#EFEDE8] text-[#5C5A55]' }
  const inFlight = c.status === 'running' || c.status === 'paused'

  const listNames = (Array.isArray(c.contact_list_ids) ? c.contact_list_ids : [])
    .map(id => contactLists.find(l => String(l.id) === String(id))?.name).filter(Boolean)
  const sent = Number(summary?.dispatched ?? c.sent_count) || 0
  const total = Number(summary?.total ?? c.total_recipients) || 0
  const failed = Number(c.failed_count) || 0
  const remaining = Math.max(0, total - sent)
  const pct = total ? Math.min(100, Math.round((sent / total) * 100)) : 0

  const speedText = c.throttle_count
    ? (() => { const w = c.throttle_window_seconds || 3600; const label = w % 86400 === 0 ? `${w / 86400} day` : w % 3600 === 0 ? `${w / 3600} hr` : `${Math.round(w / 60)} min`; return `${c.throttle_count.toLocaleString()} every ${label}` })()
    : 'No throttle'
  const scheduleText = (() => {
    const parts = []
    if (c.starts_at && new Date(c.starts_at) > new Date()) parts.push(`Starts ${fmt(c.starts_at)}`)
    const win = fmtWindows(c.send_windows)
    if (win) parts.push(`${fmtDays(c.send_days) ? `${fmtDays(c.send_days)} ` : ''}${win}${c.send_timezone ? ` (${c.send_timezone})` : ''}`)
    return parts.length ? parts.join(' · ') : 'Send now / Anytime'
  })()
  const audioUrl = c.recording_url || c.voicedrop_recording_url

  // Fetch per-recipient breakdown (also gives accurate uncapped summary counts).
  const loadRecipients = useCallback(async (showSpinner) => {
    if (!c?.id) return
    if (showSpinner) setLoadingRec(true)
    const r = await fetchWithWorkspace(`/api/voicemail-campaigns/${c.id}/recipients`).then(x => x.json()).catch(() => ({}))
    if (r?.success) { setRecipients(r.recipients || []); setSummary(r.summary || null) }
    if (showSpinner) setLoadingRec(false)
  }, [c?.id])

  // Poll the parent (refreshes status + counters) and the summary while in-flight.
  useEffect(() => {
    if (!inFlight) return
    const h = setInterval(() => { onChanged?.(); if (summary) loadRecipients(false) }, 3500)
    return () => clearInterval(h)
  }, [inFlight, onChanged, loadRecipients, summary])

  const act = async (fn, key) => { setBusy(key); try { await fn() } catch {} finally { setBusy(''); onChanged?.() } }
  const launch = () => act(() => post(`/api/voicemail-campaigns/${c.id}/start`), 'launch')
  const pause = () => act(() => post(`/api/voicemail-campaigns/${c.id}/pause`), 'pause')
  const resume = () => act(() => post(`/api/voicemail-campaigns/${c.id}/resume`), 'resume')
  const doDelete = async () => {
    setConfirmDelete(false); setBusy('delete')
    try { await post(`/api/voicemail-campaigns/${c.id}/delete`) } catch {} finally { setBusy(''); onDeleted?.() }
  }

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]" style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      {/* header: tabs + New */}
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

          {/* out-of-credits banner */}
          {c.status === 'paused' && c.paused_reason === 'insufficient_credits' && (
            <div className="bg-[#FFF8F6] border border-[rgba(214,59,31,0.3)] rounded-lg p-3.5 flex items-start gap-3">
              <i className="fas fa-circle-exclamation text-[#D63B1F] mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-[#131210]">Paused — out of credits</p>
                <p className="text-xs text-[#9B9890] mt-0.5">{remaining.toLocaleString()} recipients are still queued. Top up your wallet, then resume.</p>
              </div>
            </div>
          )}

          {/* action buttons */}
          <div className="flex flex-wrap gap-2">
            {c.status === 'draft' && <Btn onClick={launch} icon="fa-rocket" label="Launch campaign" variant="primary" disabled={!!busy} />}
            {c.status === 'draft' && onEdit && <Btn onClick={() => onEdit(c)} icon="fa-pen" label="Edit" disabled={!!busy} />}
            {c.status === 'running' && <Btn onClick={pause} icon="fa-pause" label="Pause" disabled={!!busy} />}
            {c.status === 'paused' && <Btn onClick={resume} icon="fa-play" label="Resume" variant="primary" disabled={!!busy} />}
            <Btn onClick={() => loadRecipients(true)} icon="fa-users" label="View recipients" disabled={!!busy} />
            <Btn onClick={() => setConfirmDelete(true)} icon="fa-trash" label="Delete" variant="danger" disabled={!!busy} />
          </div>

          {/* stats + progress */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Recipients" value={total.toLocaleString()} />
            <Stat label="Sent" value={sent.toLocaleString()} tint="#16A34A" />
            <Stat label="Remaining" value={remaining.toLocaleString()} tint={remaining ? '#131210' : '#16A34A'} />
          </div>
          {total > 0 && (
            <div className="bg-white border border-[#E3E1DB] rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-1.5"><span className="text-[11px] font-semibold text-[#9B9890] uppercase tracking-wide">Send progress</span><span className="text-xs text-[#5C5A55]">{sent.toLocaleString()} / {total.toLocaleString()} · {pct}%</span></div>
              <div className="h-2 rounded-full bg-[#F1EFEA] overflow-hidden"><div className={`h-full rounded-full ${c.status === 'paused' ? 'bg-yellow-400' : c.status === 'completed' ? 'bg-blue-500' : 'bg-[#16A34A]'}`} style={{ width: `${pct}%` }} /></div>
            </div>
          )}

          {/* audio */}
          <Section title="Voicemail audio">
            <div className="p-4">
              {audioUrl
                ? <audio controls src={audioUrl} className="w-full" style={{ height: 36 }} />
                : <p className="text-sm text-[#9B9890]">No recording on this campaign.</p>}
              <p className="text-[11px] text-[#9B9890] mt-2">Drops from {c.sender_number || '—'}</p>
            </div>
          </Section>

          {/* audience */}
          <Section title="Audience">
            <Row label="Contact lists" value={listNames.length ? listNames.join(', ') : `${(c.contact_list_ids || []).length || 0} list(s)`} />
            <Row label="Phone columns" value={Array.isArray(c.phone_columns) && c.phone_columns.length ? c.phone_columns.join(', ') : 'phone_number'} />
            <Row label="Skipped statuses" value={Array.isArray(c.exclude_statuses) && c.exclude_statuses.length ? c.exclude_statuses.join(', ') : 'None'} />
            {Array.isArray(c.monitor_numbers) && c.monitor_numbers.length > 0 && <Row label="Monitor lines" value={c.monitor_numbers.join(', ')} />}
          </Section>

          {/* schedule & pace */}
          <Section title="Schedule & pace">
            <Row label="Sending speed" value={speedText} />
            <Row label="When" value={scheduleText} />
            <Row label="Daily cap" value={c.daily_cap ? `${c.daily_cap.toLocaleString()} / day` : 'No cap'} />
            <Row label="Timezone" value={c.send_timezone || '—'} />
          </Section>

          {/* details */}
          <Section title="Details">
            <Row label="Status" value={st.label} />
            <Row label="Sender number" value={c.sender_number} />
            <Row label="Created" value={fmt(c.created_at)} />
            <Row label="Started at" value={fmt(c.started_at)} />
            <Row label="Completed at" value={fmt(c.completed_at)} />
            <Row label="Total recipients" value={total.toLocaleString()} />
            <Row label="Sent" value={sent.toLocaleString()} />
            <Row label="Failed" value={failed.toLocaleString()} />
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
                        <div key={r.phone + i} className="flex items-center justify-between gap-2 px-4 py-2 text-sm border-b border-[#F1EFEA] last:border-0">
                          <span className="font-mono text-[#131210] truncate">{r.phone}</span>
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
