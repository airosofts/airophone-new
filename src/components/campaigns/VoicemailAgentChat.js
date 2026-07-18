'use client'

// Ringless-voicemail (RVM) AI builder — the voicemail sibling of
// CampaignAgentChat (the SMS builder is untouched). Hybrid: the LLM writes only
// the NAME + a spoken SCRIPT to read aloud; everything else is a deterministic
// widget queue. The AI-model picker is a ChatGPT-style dropdown INSIDE the
// composer (chosen from the start). The campaign is saved as a DRAFT; the user
// launches it from the detail view (which rebuilds the queue from the lists).

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { fetchWithWorkspace } from '@/lib/api-client'
import { getCurrentUser } from '@/lib/auth'
import { fromZonedTime } from 'date-fns-tz'
import SearchableDropdown from '@/components/SearchableDropdown'
import { CONTACT_STATUSES, DEFAULT_EXCLUDED_STATUSES } from '@/lib/contact-status'

const post = (url, body) => fetchWithWorkspace(url, { method: 'POST', body: JSON.stringify(body) })
const getJSON = (url) => fetchWithWorkspace(url).then(r => r.json()).catch(() => ({}))
const phoneOf = (p) => p?.phoneNumber || p?.phone_number || ''

const SUGGESTIONS = [
  'Reactivate cold seller leads — invite them to a quick call this week',
  "Let past clients know I'm taking new referrals this month",
  'Announce a just-listed home and ask interested buyers to call back',
]

// Recommended send-rate presets (mirrors the manual RVM wizard). Each maps to a
// concrete (count, window-seconds) the backend sweeper enforces; window null = no throttle.
const THROTTLE_PRESETS = [
  { id: 'solo',  team: 'Solo',                 volume: '20–30',   count: 1,    window: 150 },
  { id: 'small', team: 'Small team (2–3)',     volume: '100/hr',  count: 25,   window: 900 },
  { id: 'mid',   team: 'Mid-sized (5+)',       volume: '200–250', count: 50,   window: 900 },
  { id: 'ent',   team: 'Enterprise',           volume: 'Uncapped', count: null, window: null },
]
const SCHEDULE_PRESETS = {
  best:     [{ start: '10:00', end: '12:00' }, { start: '14:00', end: '16:00' }],
  business: [{ start: '09:00', end: '17:00' }],
}
const TIMEZONES = [
  { id: 'America/New_York',    label: 'Eastern (ET)' },
  { id: 'America/Chicago',     label: 'Central (CT)' },
  { id: 'America/Denver',      label: 'Mountain (MT)' },
  { id: 'America/Los_Angeles', label: 'Pacific (PT)' },
]

const stageOrder = ['audio', 'sender', 'audience', 'filter', 'speed', 'schedule', 'create']

function buildTimeOptions() {
  const out = []
  for (let h = 0; h < 24; h++) for (const m of [0, 30]) {
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const hr = h % 12 === 0 ? 12 : h % 12
    const label = `${hr}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
    out.push({ value, label, searchText: label })
  }
  return out
}
const pad2 = (n) => String(n).padStart(2, '0')

// Encode mono Float32 PCM samples into a 16-bit WAV — VoiceDrop accepts WAV, but
// MediaRecorder only gives webm/mp4, so the live recorder captures raw PCM here.
function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  writeStr(36, 'data'); view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2 }
  return view
}

// Styled calendar — pick ANY date of ANY month; past days are disabled.
function DatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => (value ? new Date(`${value}T00:00:00`) : new Date()))
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [])
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const y = view.getFullYear(), m = view.getMonth()
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const selLabel = value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 border rounded-lg bg-white px-3 py-3 text-sm transition-colors ${open ? 'border-[#D63B1F] ring-2 ring-[#D63B1F]/20' : 'border-[#D4D1C9]'}`}>
        <span className={selLabel ? 'text-[#131210]' : 'text-[#9B9890]'}>{selLabel || 'Pick a date…'}</span>
        <i className="fas fa-calendar-day text-[#9B9890] text-xs" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-30 bg-white border border-[#E3E1DB] rounded-xl shadow-xl p-3 w-72">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#F7F6F3] text-[#5C5A55]"><i className="fas fa-chevron-left text-xs" /></button>
            <span className="text-sm font-semibold text-[#131210]">{view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
            <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#F7F6F3] text-[#5C5A55]"><i className="fas fa-chevron-right text-xs" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => <div key={d} className="text-center text-[10px] font-medium text-[#9B9890] py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (!d) return <div key={i} />
              const val = `${y}-${pad2(m + 1)}-${pad2(d)}`
              const dObj = new Date(y, m, d)
              const isPast = dObj < today
              const isSel = value === val
              const isToday = dObj.getTime() === today.getTime()
              return (
                <button key={i} type="button" disabled={isPast} onClick={() => { onChange(val); setOpen(false) }}
                  className={`h-8 rounded-lg text-sm transition-colors ${isSel ? 'bg-[#D63B1F] text-white font-semibold' : isPast ? 'text-[#D4D1C9] cursor-not-allowed' : 'text-[#131210] hover:bg-[#F7F6F3]'} ${isToday && !isSel ? 'ring-1 ring-[#D63B1F]/40' : ''}`}>
                  {d}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2.5 border border-[#D4D1C9] rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D63B1F]/20 focus:border-[#D63B1F]'
const labelCls = 'block text-[11px] font-semibold text-[#9B9890] uppercase tracking-wide mb-1.5'
const contBtn = 'mt-3 w-full bg-[#131210] hover:bg-[#3C3A35] text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50 transition-colors'

function TypingDots() {
  return <span className="inline-flex gap-1">{[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#B5B2AA] animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />)}</span>
}
function Card({ title, subtitle, children }) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] bg-white rounded-2xl rounded-bl-md border border-[#E3E1DB] shadow-sm p-4">
        <p className="text-sm font-semibold text-[#131210]">{title}</p>
        {subtitle && <p className="text-xs text-[#9B9890] mt-0.5 mb-1">{subtitle}</p>}
        <div className="mt-2">{children}</div>
      </div>
    </div>
  )
}
function Done({ label, value, onChange }) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-[#F3F7F4] border border-[#E3E1DB]">
        <span className="text-xs text-[#5C5A55]"><b className="text-[#131210]">{label}:</b> {value}</span>
        {onChange && <button onClick={onChange} className="text-[11px] font-semibold text-[#D63B1F] hover:underline shrink-0">Change</button>}
      </div>
    </div>
  )
}
function Pills({ options, value, onPick }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button key={o.v} onClick={() => onPick(o.v)}
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${value === o.v ? 'bg-[#131210] text-white border-[#131210]' : 'bg-white text-[#5C5A55] border-[#D4D1C9] hover:border-[#131210]'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ChatGPT-style model dropdown inside the composer.
function ModelPicker({ models, value, onChange, locked }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [])
  const cur = models.find(m => m.id === value)
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => !locked && setOpen(o => !o)} disabled={locked}
        title={locked ? 'The model is locked once the chat starts' : undefined}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#5C5A55] enabled:hover:bg-[#F7F6F3] border border-transparent enabled:hover:border-[#E3E1DB] transition-colors disabled:cursor-default">
        {models.length === 0
          ? <i className="fas fa-spinner fa-spin text-[10px] text-[#9B9890]" />
          : <i className="fas fa-microchip text-[10px] text-[#9B9890]" />}
        <span className="max-w-[120px] truncate">{models.length === 0 ? 'Loading…' : (cur ? `${cur.vendor} ${cur.label}` : 'Model')}</span>
        <i className={`fas ${locked ? 'fa-lock' : 'fa-chevron-down'} text-[9px] text-[#9B9890]`} />
      </button>
      {open && !locked && (
        <div className="absolute top-full right-0 mt-1.5 w-60 bg-white border border-[#E3E1DB] rounded-xl shadow-lg py-1 z-30">
          <p className="px-3 py-1.5 text-[10px] font-semibold text-[#9B9890] uppercase tracking-wide">Model</p>
          {models.length === 0 && (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-[#9B9890]"><i className="fas fa-spinner fa-spin text-[10px]" /> Loading models…</p>
          )}
          {models.map(m => (
            <button key={m.id} disabled={!m.available} onClick={() => { onChange(m.id); setOpen(false) }}
              className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#F7F6F3] disabled:opacity-40 disabled:cursor-not-allowed">
              <span className="text-[#131210]">{m.vendor} · {m.label}{m.isDefault ? '  · Default' : ''}</span>
              {value === m.id ? <i className="fas fa-check text-[#D63B1F] text-[10px]" /> : (!m.available && <span className="text-[9px] text-[#9B9890]">key needed</span>)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Composer({ rows, placeholder, input, setInput, onSend, busy, models, model, setModel, locked }) {
  return (
    <div className="bg-white border border-[#E3E1DB] rounded-2xl shadow-sm focus-within:border-[#D63B1F] focus-within:ring-2 focus-within:ring-[#D63B1F]/10">
      <textarea value={input} onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
        rows={rows} placeholder={placeholder}
        className="w-full px-4 pt-3.5 pb-1 text-sm text-[#131210] placeholder-[#9B9890] bg-transparent rounded-2xl resize-none focus:outline-none" />
      <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 pt-1">
        <ModelPicker models={models} value={model} onChange={setModel} locked={locked} />
        <button type="button" onClick={onSend} disabled={busy || !input.trim()} title="Send"
          className="w-8 h-8 rounded-full bg-[#D63B1F] hover:bg-[#c23119] text-white flex items-center justify-center disabled:opacity-40 shrink-0">
          <i className="fas fa-arrow-up text-xs" />
        </button>
      </div>
    </div>
  )
}

// Record / upload / reuse the voicemail audio — a self-contained port of the
// manual wizard's audio step. Calls onChange(uploadState) when audio is ready.
// uploadState: { url, voicedropUrl, path, name }.
function AudioPicker({ value, onChange, onError }) {
  const [uploading, setUploading] = useState(false)
  const [library, setLibrary] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [recording, setRecording] = useState(null)   // null | 'recording' | { blob, url, seconds }
  const fileInputRef = useRef(null)
  const uploadAbortRef = useRef(null)
  const audioCtxRef = useRef(null)
  const procRef = useRef(null)
  const sourceRef = useRef(null)
  const recStreamRef = useRef(null)
  const pcmChunksRef = useRef([])
  const recSampleRateRef = useRef(44100)
  const analyserRef = useRef(null)
  const rafRef = useRef(null)
  const canvasRef = useRef(null)

  const fetchLibrary = useCallback(async () => {
    setLibraryLoading(true)
    try {
      const d = await getJSON('/api/voicemail-recordings')
      if (d?.success) setLibrary(d.recordings || [])
    } finally { setLibraryLoading(false) }
  }, [])
  useEffect(() => { fetchLibrary() }, [fetchLibrary])

  const uploadAudioFile = async (file, displayName) => {
    setUploading(true); onError('')
    const form = new FormData()
    form.append('file', file, file.name)
    const controller = new AbortController()
    uploadAbortRef.current = controller
    try {
      const user = getCurrentUser()
      const res = await fetch('/api/voicemail-campaigns/upload-audio', {
        method: 'POST',
        headers: { 'x-workspace-id': user?.workspaceId, 'x-user-id': user?.userId },
        body: form, signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok || !data.success) { onError(data.error || 'Upload failed'); return }
      onChange({ url: data.url, voicedropUrl: data.voicedrop_url, path: data.path, name: displayName || file.name })
      fetchLibrary()
    } catch (err) {
      if (err?.name === 'AbortError') return
      onError('Upload failed. Please try again.')
    } finally { setUploading(false); uploadAbortRef.current = null }
  }
  const cancelUpload = () => { uploadAbortRef.current?.abort(); setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  const handleFileChange = (e) => { const f = e.target.files?.[0]; if (f) uploadAudioFile(f, f.name) }

  const drawVisualizer = () => {
    rafRef.current = requestAnimationFrame(drawVisualizer)
    const analyser = analyserRef.current, canvas = canvasRef.current
    if (!analyser || !canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width, h = canvas.height
    const bins = analyser.frequencyBinCount
    const data = new Uint8Array(bins)
    analyser.getByteFrequencyData(data)
    ctx.clearRect(0, 0, w, h)
    const bars = 48, step = Math.max(1, Math.floor(bins / bars)), barW = w / bars
    for (let i = 0; i < bars; i++) {
      const v = (data[i * step] || 0) / 255
      const bh = Math.max(2, v * h)
      ctx.fillStyle = '#D63B1F'
      ctx.fillRect(i * barW + barW * 0.25, (h - bh) / 2, barW * 0.5, bh)
    }
  }
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recStreamRef.current = stream
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      recSampleRateRef.current = ctx.sampleRate
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      procRef.current = proc
      pcmChunksRef.current = []
      proc.onaudioprocess = (e) => { pcmChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0))) }
      source.connect(proc); proc.connect(ctx.destination)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.7
      source.connect(analyser)
      analyserRef.current = analyser
      onError('')
      setRecording('recording')
      rafRef.current = requestAnimationFrame(drawVisualizer)
    } catch {
      onError('Could not access the microphone — check browser permissions.')
    }
  }
  const stopRecording = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    analyserRef.current = null
    try { if (procRef.current) procRef.current.onaudioprocess = null; sourceRef.current?.disconnect(); procRef.current?.disconnect() } catch {}
    recStreamRef.current?.getTracks().forEach(t => t.stop())
    const chunks = pcmChunksRef.current
    let len = 0; for (const c of chunks) len += c.length
    const pcm = new Float32Array(len); let off = 0
    for (const c of chunks) { pcm.set(c, off); off += c.length }
    const sr = recSampleRateRef.current
    const blob = new Blob([encodeWAV(pcm, sr)], { type: 'audio/wav' })
    setRecording({ blob, url: URL.createObjectURL(blob), seconds: Math.max(1, Math.round(len / sr)) })
    try { audioCtxRef.current?.close() } catch {}
  }
  const discardRecording = () => { if (recording?.url) URL.revokeObjectURL(recording.url); setRecording(null) }
  const useRecording = async () => {
    if (!recording?.blob) return
    const file = new File([recording.blob], `recording-${recording.seconds}s.wav`, { type: 'audio/wav' })
    discardRecording()
    await uploadAudioFile(file, 'Live recording')
  }
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    recStreamRef.current?.getTracks().forEach(t => t.stop())
    try { audioCtxRef.current?.close() } catch {}
  }, [])

  if (uploading) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 border border-[#D4D1C9] rounded-lg text-sm text-[#5C5A55]">
        <i className="fas fa-spinner fa-spin" /><span className="flex-1">Uploading…</span>
        <button type="button" onClick={cancelUpload} className="px-2.5 py-1 text-xs font-medium text-[#D63B1F] border border-[#D63B1F] rounded hover:bg-[#FFF8F6]"><i className="fas fa-times mr-1" /> Cancel</button>
      </div>
    )
  }
  if (value) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 border border-[#E3E1DB] rounded-lg bg-[#F7F6F3]">
        <i className="fas fa-music text-[#D63B1F]" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#131210] truncate">{value.name}</p>
          {value.url && <audio controls src={value.url} className="w-full mt-1" style={{ height: 30 }} />}
        </div>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-[#9B9890] hover:text-[#5C5A55] shrink-0">Replace</button>
      </div>
    )
  }
  if (recording === 'recording') {
    return (
      <div className="flex items-center gap-3 px-4 py-3 border border-[#D63B1F] rounded-lg bg-[#FFF8F6]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#D63B1F] animate-pulse flex-shrink-0" />
        <span className="text-sm text-[#131210] flex-shrink-0">Recording…</span>
        <canvas ref={canvasRef} width={360} height={32} className="flex-1 min-w-0 h-8" />
        <button type="button" onClick={stopRecording} className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] rounded-md hover:bg-[#c4351b]"><i className="fas fa-stop mr-1.5 text-[11px]" /> Stop</button>
      </div>
    )
  }
  if (recording) {
    return (
      <div className="px-4 py-3 border border-[#E3E1DB] rounded-lg bg-[#F7F6F3] space-y-2.5">
        <p className="text-xs text-[#5C5A55]">Your recording ({recording.seconds}s) — listen back:</p>
        <audio controls src={recording.url} className="w-full" style={{ height: 34 }} />
        <div className="flex items-center gap-2">
          <button type="button" onClick={useRecording} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D63B1F] rounded-md hover:bg-[#c4351b]"><i className="fas fa-check mr-1.5 text-[11px]" /> Use this recording</button>
          <button type="button" onClick={() => { discardRecording(); startRecording() }} className="px-3 py-1.5 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-md hover:bg-white"><i className="fas fa-rotate-left mr-1.5 text-[11px]" /> Re-record</button>
          <button type="button" onClick={discardRecording} className="px-3 py-1.5 text-sm text-[#9B9890] hover:text-[#5C5A55]">Discard</button>
        </div>
      </div>
    )
  }
  return (
    <>
      <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileChange} className="hidden" />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => fileInputRef.current?.click()} className="px-4 py-5 border-2 border-dashed border-[#D4D1C9] rounded-lg text-sm text-[#5C5A55] hover:border-[#D63B1F] hover:bg-[#FFF8F6]"><i className="fas fa-cloud-upload-alt mr-2" /> Upload audio</button>
        <button type="button" onClick={startRecording} className="px-4 py-5 border-2 border-dashed border-[#D4D1C9] rounded-lg text-sm text-[#5C5A55] hover:border-[#D63B1F] hover:bg-[#FFF8F6]"><i className="fas fa-microphone mr-2 text-[#D63B1F]" /> Record now</button>
      </div>
      <button type="button" onClick={() => { setShowLibrary(v => !v); if (!library.length) fetchLibrary() }}
        className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-[#E3E1DB] rounded-lg text-sm text-[#5C5A55] hover:bg-[#F7F6F3]">
        <i className="fas fa-folder-open text-[#D63B1F]" /> Choose from library
        {library.length > 0 && <span className="text-[11px] text-[#9B9890]">({library.length})</span>}
        <i className={`fas fa-chevron-${showLibrary ? 'up' : 'down'} text-[10px] text-[#9B9890]`} />
      </button>
      {showLibrary && (
        <div className="mt-2 border border-[#E3E1DB] rounded-lg overflow-hidden">
          {libraryLoading && <p className="px-4 py-4 text-xs text-[#9B9890] text-center"><i className="fas fa-spinner fa-spin mr-1.5" />Loading saved recordings…</p>}
          {!libraryLoading && library.length === 0 && <p className="px-4 py-5 text-xs text-[#9B9890] text-center">No saved recordings yet. Audio you upload or record is saved here automatically.</p>}
          {!libraryLoading && library.length > 0 && (
            <div className="max-h-56 overflow-y-auto divide-y divide-[#F0EEE9]">
              {library.map(rec => (
                <div key={rec.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#F7F6F3]">
                  <i className="fas fa-music text-[#D63B1F] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#131210] truncate" title={rec.name}>{rec.name}</p>
                    {rec.url && <audio controls src={rec.url} className="w-full mt-1" style={{ height: 30 }} />}
                  </div>
                  <button type="button" onClick={() => { onChange({ url: rec.url, voicedropUrl: rec.voicedrop_url, path: rec.path, name: rec.name }); setShowLibrary(false) }}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-[#D63B1F] rounded-md hover:bg-[#c4351b]">Use</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

export default function VoicemailAgentChat({ onSwitchToManual, inline = false, onCreated, headerTabs = null }) {
  const router = useRouter()
  const bottomRef = useRef(null)

  const [models, setModels] = useState([])
  const [phoneNumbers, setPhoneNumbers] = useState([])   // voicemail-verified only
  const [contactLists, setContactLists] = useState([])
  const [businessHours, setBusinessHours] = useState(null)
  const [loadingLookups, setLoadingLookups] = useState(true)
  const [detectedColumns, setDetectedColumns] = useState([])
  const [loadingColumns, setLoadingColumns] = useState(false)

  const [model, setModel] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ name: '', script: '' })
  const [promptAccepted, setPromptAccepted] = useState(false)

  const [stage, setStage] = useState('audio')
  const [audio, setAudio] = useState(null)               // { url, voicedropUrl, path, name }
  const [senderNumber, setSenderNumber] = useState('')   // the phone-number string of a verified line
  const [selectedListIds, setSelectedListIds] = useState([])
  const [selectedColumns, setSelectedColumns] = useState([])
  const [excludeStatuses, setExcludeStatuses] = useState(DEFAULT_EXCLUDED_STATUSES)
  const [throttleMode, setThrottleMode] = useState('recommended')
  const [presetId, setPresetId] = useState('small')
  const [throttleCount, setThrottleCount] = useState(100)
  const [throttleWindowValue, setThrottleWindowValue] = useState(15)
  const [throttleUnit, setThrottleUnit] = useState('minute')
  const [whenMode, setWhenMode] = useState('now')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleClock, setScheduleClock] = useState('')
  const [sendTimezone, setSendTimezone] = useState('America/New_York')
  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(false)
  const [dailyLimit, setDailyLimit] = useState(500)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    (async () => {
      const [m, p, cl, bh] = await Promise.all([
        getJSON('/api/ai-models'), getJSON('/api/phone-numbers'), getJSON('/api/contact-lists'),
        getJSON('/api/workspace/business-hours'),
      ])
      const ml = m?.models || []
      setModels(ml)
      const def = ml.find(x => x.isDefault && x.available) || ml.find(x => x.available)
      if (def) setModel(def.id)
      setPhoneNumbers((p?.phoneNumbers || []).filter(x => x.voicedrop_verified))
      setContactLists(cl?.contactLists || cl?.lists || (Array.isArray(cl) ? cl : []))
      if (bh && (bh.start || bh.end)) setBusinessHours(bh)
      setLoadingLookups(false)
    })()
  }, [])

  // Detect phone columns once ≥1 contact list is chosen (mirrors the manual wizard).
  useEffect(() => {
    if (selectedListIds.length === 0) { setDetectedColumns([]); return }
    let cancelled = false
    setLoadingColumns(true)
    post('/api/voicemail-campaigns/preview', { contactListIds: selectedListIds })
      .then(r => r.json())
      .then(d => { if (!cancelled && d?.success) setDetectedColumns(d.detectedColumns || []) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingColumns(false) })
    return () => { cancelled = true }
  }, [selectedListIds.join(',')])

  // Default the column selection to the primary once columns are detected.
  useEffect(() => {
    if (detectedColumns.length === 0) return
    setSelectedColumns(prev => {
      if (prev.length) return prev.filter(k => detectedColumns.some(c => c.key === k))
      const primary = detectedColumns.find(c => c.isPrimary) || detectedColumns[0]
      return primary ? [primary.key] : []
    })
  }, [detectedColumns])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, promptAccepted, stage, draft, busy])

  const applySettings = useCallback((s) => {
    if (!s) return
    if (s.sender_number_id) {
      const p = phoneNumbers.find(x => String(x.id) === String(s.sender_number_id))
      if (p) setSenderNumber(phoneOf(p))
    }
    if (Array.isArray(s.contact_list_ids) && s.contact_list_ids.length) {
      setSelectedListIds(s.contact_list_ids.map(String))
    }
  }, [phoneNumbers])

  const sendDescribe = async () => {
    const text = input.trim()
    if (!text || busy) return
    setError(''); setInput('')
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next); setBusy(true)
    try {
      const res = await post('/api/voicemail-campaigns/builder-chat', { messages: next, current: draft, model })
      const d = await res.json()
      if (!res.ok || !d.success) throw new Error(d.error || 'The assistant could not respond.')
      setDraft({ name: d.name, script: d.script })
      applySettings(d.settings)
      setMessages(m => [...m, { role: 'assistant', content: d.reply }])
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const order = stageOrder
  const idx = (s) => order.indexOf(s)
  const stepState = (s) => (idx(s) < idx(stage) ? 'done' : idx(s) === idx(stage) ? 'active' : 'pending')
  const advance = (from) => { setStage(order[order.indexOf(from) + 1] || 'create') }

  const toggleList = (id) => setSelectedListIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const toggleColumn = (k) => setSelectedColumns(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
  const toggleStatus = (id) => setExcludeStatuses(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const selectedPreset = THROTTLE_PRESETS.find(p => p.id === presetId) || THROTTLE_PRESETS[1]
  const unitToSeconds = (u) => (u === 'day' ? 86400 : u === 'hour' ? 3600 : 60)
  const resolvedThrottleCount = throttleMode === 'recommended' ? selectedPreset.count : throttleMode === 'manual' ? throttleCount : null
  const resolvedThrottleWindowSeconds = throttleMode === 'recommended' ? (selectedPreset.window || 3600)
    : throttleMode === 'manual' ? Math.max(60, throttleWindowValue * unitToSeconds(throttleUnit)) : 3600

  const resolvedSendWindows = whenMode === 'best' ? SCHEDULE_PRESETS.best
    : whenMode === 'business' ? (businessHours ? [{ start: String(businessHours.start).slice(0, 5), end: String(businessHours.end).slice(0, 5) }] : SCHEDULE_PRESETS.business)
    : null
  const resolvedSendDays = whenMode === 'best' ? [1, 2, 3, 4, 5]
    : whenMode === 'business' && Array.isArray(businessHours?.days) && businessHours.days.length > 0 && businessHours.days.length < 7 ? [...businessHours.days].sort((a, b) => a - b)
    : null
  const resolvedTimezone = (whenMode === 'business' && businessHours?.tz) ? businessHours.tz : sendTimezone
  let resolvedStartsAt = null
  if (whenMode === 'later' && scheduleDate && scheduleClock) {
    try { resolvedStartsAt = fromZonedTime(`${scheduleDate}T${scheduleClock}`, resolvedTimezone).toISOString() } catch {}
  }
  const resolvedDailyCap = dailyLimitEnabled && dailyLimit > 0 ? Math.floor(dailyLimit) : null

  const senderLabel = () => { const p = phoneNumbers.find(x => phoneOf(x) === senderNumber); return p ? (p.custom_name ? `${p.custom_name} (${phoneOf(p)})` : phoneOf(p)) : (senderNumber || '—') }
  const audienceLabel = () => {
    const names = selectedListIds.map(id => contactLists.find(l => String(l.id) === String(id))?.name).filter(Boolean)
    const cols = selectedColumns.length > 1 ? ` · ${selectedColumns.length} columns` : ''
    return `${names.join(', ') || '—'}${cols}`
  }
  const speedLabel = () => throttleMode === 'recommended' ? `${selectedPreset.team} · ${selectedPreset.volume}`
    : throttleMode === 'manual' ? `${throttleCount} every ${throttleWindowValue} ${throttleUnit}${throttleWindowValue === 1 ? '' : 's'}` : 'No throttle'
  const scheduleLabel = () => whenMode === 'now' ? 'Send now'
    : whenMode === 'later' ? (resolvedStartsAt ? new Date(resolvedStartsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Scheduled')
    : whenMode === 'best' ? 'Best calling windows' : 'Business hours'
  const filterLabel = () => excludeStatuses.length === 0 ? 'Send to everyone'
    : `Skip ${excludeStatuses.map(id => CONTACT_STATUSES.find(s => s.id === id)?.label || id).join(', ')}`

  const create = async () => {
    setCreating(true); setError('')
    try {
      if (!audio) throw new Error('Please add a voicemail recording first.')
      const payload = {
        name: draft.name || 'New voicemail campaign',
        recordingUrl: audio.voicedropUrl || audio.url,
        recordingPath: audio.path || null,
        voicedropRecordingUrl: audio.voicedropUrl || null,
        senderNumber,
        contactListIds: selectedListIds,
        phoneColumns: selectedColumns.length ? selectedColumns : ['phone_number'],
        throttleCount: resolvedThrottleCount,
        throttleWindowSeconds: resolvedThrottleWindowSeconds,
        sendWindows: resolvedSendWindows,
        sendTimezone: resolvedTimezone,
        sendDays: resolvedSendDays,
        dailyCap: resolvedDailyCap,
        excludeStatuses,
        startsAt: resolvedStartsAt,
      }
      const res = await post('/api/voicemail-campaigns', payload)
      const d = await res.json()
      if (!res.ok || !d.campaign?.id) throw new Error([d.error, d.details].filter(Boolean).join(' — ') || 'Could not create the campaign.')
      if (onCreated) onCreated(d.campaign); else router.push('/campaigns')
    } catch (e) { setError(e.message); setCreating(false) }
  }

  const hasThread = messages.length > 0 || !!draft.script
  const composerProps = { input, setInput, onSend: sendDescribe, busy, models, model, setModel, locked: messages.length > 0 }

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]" style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[#E3E1DB] bg-white shrink-0">
        {headerTabs ? (
          <>{headerTabs}<div className="flex-1" /></>
        ) : (
          <>
            {!inline && (
              <button onClick={() => router.push('/campaigns')} title="Back" className="p-2 -ml-1 rounded-lg text-[#5C5A55] hover:bg-[#F7F6F3]">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              </button>
            )}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-[#D63B1F] flex items-center justify-center shrink-0"><i className="fas fa-wand-magic-sparkles text-white text-xs" /></span>
              <p className="text-base font-semibold text-[#131210] truncate">New voicemail</p>
            </div>
          </>
        )}
        <button onClick={onSwitchToManual} className="px-4 py-2 text-sm text-[#5C5A55] border border-[#E3E1DB] rounded-lg hover:bg-[#F7F6F3] shrink-0">
          <i className="fas fa-sliders mr-1.5 text-xs" />Set up manually
        </button>
      </div>

      {error && <div className="px-5 py-2 text-xs bg-[rgba(214,59,31,0.07)] border-b border-[rgba(214,59,31,0.16)] text-[#D63B1F] shrink-0">{error}</div>}

      {!hasThread ? (
        /* Empty state — centered hero */
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 pt-14 md:pt-24 pb-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#D63B1F] flex items-center justify-center mx-auto mb-5 shadow-sm"><i className="fas fa-voicemail text-white text-xl" /></div>
            <h1 className="text-2xl md:text-3xl font-semibold text-[#131210] tracking-tight">Build your <span className="text-[#D63B1F] font-extrabold text-[1.1em]">voicemail</span> with AI</h1>
            <p className="text-sm text-[#5C5A55] mt-2">Describe the message and who it&rsquo;s for — I&rsquo;ll write the script and set the drop up.</p>
            <p className="text-xs text-[#9B9890] mt-2 mb-8 max-w-lg mx-auto leading-relaxed"><i className="fas fa-circle-info mr-1.5 text-[10px]" />A ringless voicemail drops a recording into many inboxes at once — phones never ring. You record the audio, then launch it from the list.</p>
            <div className="text-left"><Composer rows={3} placeholder="e.g. Reactivate cold seller leads and invite them to a quick call…" {...composerProps} /></div>
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" onClick={() => setInput(s)} className="px-3.5 py-2 text-xs text-[#5C5A55] bg-white border border-[#E3E1DB] rounded-full hover:border-[#D63B1F]/40 hover:text-[#131210] transition-colors">{s}</button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Chat thread */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
            <div className="max-w-3xl mx-auto space-y-3">
              {messages.map((m, i) => (
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end"><div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap bg-[#D63B1F] text-white">{m.content}</div></div>
                ) : (
                  <div key={i} className="flex justify-start"><div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed bg-white border border-[#E3E1DB] text-[#131210] whitespace-pre-wrap">{m.content}</div></div>
                )
              ))}

              {/* Draft card — collapses to a compact line once accepted */}
              {draft.script && (promptAccepted
                ? <Done label="Script" value={draft.name || 'Voicemail'} onChange={() => setPromptAccepted(false)} />
                : (
                  <Card title="Here's your voicemail" subtitle="Read this aloud when you record — tweak it if you like.">
                    <label className={labelCls}>Campaign name</label>
                    <input className={`${inputCls} mb-3`} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                    <label className={labelCls}>Voicemail script</label>
                    <textarea rows={5} className={`${inputCls} resize-none`} value={draft.script} onChange={e => setDraft(d => ({ ...d, script: e.target.value }))} />
                    <p className="text-[11px] text-[#9B9890] mt-1">This is the script you&rsquo;ll read when recording — it isn&rsquo;t sent as text.</p>
                    <button onClick={() => setPromptAccepted(true)} disabled={!draft.script.trim()} className="mt-3 w-full bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-50">Use this script →</button>
                  </Card>
                ))}

              {busy && <div className="flex justify-start"><div className="bg-white border border-[#E3E1DB] px-4 py-3 rounded-2xl rounded-bl-md"><span className="inline-flex items-center gap-2.5 text-xs text-[#5C5A55]"><TypingDots /> Writing…</span></div></div>}

              {/* Queue */}
              {promptAccepted && (
                <>
                  {stepState('audio') === 'done'
                    ? <Done label="Recording" value={audio?.name || 'Audio ready'} onChange={() => setStage('audio')} />
                    : stepState('audio') === 'active' && (
                      <Card title="Add your voicemail recording" subtitle="Record it now, upload a file, or reuse one from your library.">
                        <AudioPicker value={audio} onChange={setAudio} onError={setError} />
                        <button onClick={() => advance('audio')} disabled={!audio} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('sender') === 'done'
                    ? <Done label="Send from" value={senderLabel()} onChange={() => setStage('sender')} />
                    : stepState('sender') === 'active' && (
                      <Card title="Which number should it send from?" subtitle="Only voicemail-verified lines can drop RVMs.">
                        {phoneNumbers.length === 0 ? (
                          <p className="text-xs text-[#9B9890]">No voicemail-verified numbers. Verify one in <b>Settings → Phone Numbers</b> first.</p>
                        ) : (
                          <SearchableDropdown value={senderNumber} onChange={setSenderNumber} loading={loadingLookups} placeholder="Select a verified number…"
                            options={phoneNumbers.map(p => ({ value: phoneOf(p), label: p.custom_name ? `${p.custom_name} (${phoneOf(p)})` : phoneOf(p), searchText: `${p.custom_name || ''} ${phoneOf(p)}` }))}
                            renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                        )}
                        <button onClick={() => advance('sender')} disabled={!senderNumber} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('audience') === 'done'
                    ? <Done label="Audience" value={audienceLabel()} onChange={() => setStage('audience')} />
                    : stepState('audience') === 'active' && (
                      <Card title="Who should get it?" subtitle="Pick contact lists, then the phone columns to send to.">
                        {contactLists.length === 0 ? (
                          loadingLookups
                            ? <p className="text-xs text-[#9B9890]"><i className="fas fa-spinner fa-spin mr-1.5" />Loading lists…</p>
                            : <p className="text-xs text-[#9B9890]">No contact lists yet — import one in Contacts first.</p>
                        ) : (
                          <div className="border border-[#E3E1DB] rounded-lg max-h-44 overflow-y-auto">
                            {contactLists.map(l => (
                              <label key={l.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F7F6F3] border-b border-[#F0EEE9] last:border-0">
                                <input type="checkbox" checked={selectedListIds.includes(String(l.id))} onChange={() => toggleList(String(l.id))} className="w-4 h-4 accent-[#D63B1F]" />
                                <span className="text-sm text-[#131210] flex-1">{l.name}</span>
                                <span className="text-xs text-[#9B9890]">{l.contact_count ?? l.contactCount ?? l.contactsCount ?? ''}</span>
                              </label>
                            ))}
                          </div>
                        )}
                        {selectedListIds.length > 0 && (
                          <div className="mt-3">
                            <label className={labelCls}>Phone columns {loadingColumns && <i className="fas fa-spinner fa-spin ml-1 text-[#9B9890]" />}</label>
                            {detectedColumns.length === 0 && !loadingColumns ? (
                              <p className="text-xs text-[#9B9890]">No phone-like values found in these lists.</p>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {detectedColumns.map(col => (
                                  <label key={col.key} className={`flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${selectedColumns.includes(col.key) ? 'border-[#D63B1F] bg-[#FFF8F6]' : 'border-[#E3E1DB] hover:bg-[#F7F6F3]'}`}>
                                    <input type="checkbox" checked={selectedColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} className="w-4 h-4 accent-[#D63B1F]" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-[#131210] truncate">{col.label}</p>
                                      <p className="text-[11px] text-[#9B9890]">{col.count} contacts{col.isPrimary ? ' · primary' : ''}</p>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <button onClick={() => advance('audience')} disabled={selectedListIds.length === 0 || selectedColumns.length === 0} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('filter') === 'done'
                    ? <Done label="Filter" value={filterLabel()} onChange={() => setStage('filter')} />
                    : stepState('filter') === 'active' && (
                      <Card title="Skip anyone?" subtitle="Don't drop to contacts marked with these call outcomes.">
                        <div className="flex flex-wrap gap-2">
                          {CONTACT_STATUSES.map(s => {
                            const on = excludeStatuses.includes(s.id)
                            return (
                              <button key={s.id} type="button" onClick={() => toggleStatus(s.id)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${on ? 'border-transparent' : 'border-[#E3E1DB] bg-white text-[#9B9890] hover:bg-[#F7F6F3]'}`}
                                style={on ? { color: s.color, background: s.bg } : undefined}>
                                <span className="w-2 h-2 rounded-full" style={{ background: on ? s.color : '#C9C6BF' }} />
                                {s.label}{on && <i className="fas fa-check text-[10px]" />}
                              </button>
                            )
                          })}
                        </div>
                        <button onClick={() => advance('filter')} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('speed') === 'done'
                    ? <Done label="Speed" value={speedLabel()} onChange={() => setStage('speed')} />
                    : stepState('speed') === 'active' && (
                      <Card title="How fast should it send?" subtitle="Pace the drops so your team can handle callbacks.">
                        <Pills value={throttleMode} onPick={setThrottleMode} options={[{ v: 'recommended', label: 'Recommended' }, { v: 'manual', label: 'Manual' }, { v: 'max', label: 'No throttle' }]} />
                        {throttleMode === 'recommended' && (
                          <div className="mt-2 border border-[#E3E1DB] rounded-lg overflow-hidden">
                            {THROTTLE_PRESETS.map((p, i) => (
                              <label key={p.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${i > 0 ? 'border-t border-[#F0EEE9]' : ''} ${presetId === p.id ? 'bg-[#FFF8F6]' : 'hover:bg-[#F7F6F3]'}`}>
                                <input type="radio" name="rvm-ai-preset" checked={presetId === p.id} onChange={() => setPresetId(p.id)} className="w-4 h-4 accent-[#D63B1F]" />
                                <span className="flex-1 text-sm font-medium text-[#131210]">{p.team}</span>
                                <span className="text-xs text-[#9B9890]">{p.volume}</span>
                              </label>
                            ))}
                          </div>
                        )}
                        {throttleMode === 'manual' && (
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-[#5C5A55]">Up to</span>
                            <input type="number" min={1} value={throttleCount} onChange={e => setThrottleCount(Math.max(1, parseInt(e.target.value) || 1))} className="w-20 px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm" />
                            <span className="text-sm text-[#5C5A55]">every</span>
                            <input type="number" min={1} value={throttleWindowValue} onChange={e => setThrottleWindowValue(Math.max(1, parseInt(e.target.value) || 1))} className="w-16 px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm" />
                            <select value={throttleUnit} onChange={e => setThrottleUnit(e.target.value)} className="px-2.5 py-1.5 border border-[#D4D1C9] rounded-md text-sm bg-white">
                              <option value="minute">min</option><option value="hour">hr</option><option value="day">day</option>
                            </select>
                          </div>
                        )}
                        {throttleMode === 'max' && <p className="text-[11px] text-[#9B9890] mt-2">Best for small lists or when you can handle callbacks immediately.</p>}
                        <button onClick={() => advance('speed')} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('schedule') === 'done'
                    ? <Done label="Schedule" value={scheduleLabel()} onChange={() => setStage('schedule')} />
                    : stepState('schedule') === 'active' && (
                      <Card title="When should it send?">
                        <Pills value={whenMode} onPick={setWhenMode} options={[{ v: 'now', label: 'Send now' }, { v: 'later', label: 'Schedule' }, { v: 'best', label: 'Best windows' }, { v: 'business', label: 'Business hours' }]} />
                        {whenMode === 'later' && (
                          <div className="space-y-2 mt-2">
                            <div className="grid grid-cols-2 gap-2">
                              <DatePicker value={scheduleDate} onChange={setScheduleDate} />
                              <SearchableDropdown value={scheduleClock} onChange={setScheduleClock} placeholder="Pick a time…" forceDown
                                options={buildTimeOptions()} renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                            </div>
                            <SearchableDropdown value={sendTimezone} onChange={setSendTimezone} placeholder="Timezone…"
                              options={TIMEZONES.map(t => ({ value: t.id, label: t.label, searchText: t.label }))} renderSelected={o => o.label} renderOption={o => <p className="text-sm text-[#131210]">{o.label}</p>} />
                          </div>
                        )}
                        {whenMode === 'best' && <p className="text-[11px] text-[#9B9890] mt-2">Sends Mon–Fri, 10–12 &amp; 2–4 only (best callback windows).</p>}
                        {whenMode === 'business' && <p className="text-[11px] text-[#9B9890] mt-2">Uses your workspace business hours{businessHours ? '' : ' (defaults to 9–5)'}.</p>}
                        <label className="flex items-center gap-2 text-sm text-[#5C5A55] mt-3">
                          <input type="checkbox" checked={dailyLimitEnabled} onChange={e => setDailyLimitEnabled(e.target.checked)} className="w-4 h-4 accent-[#D63B1F]" /> Cap per day
                          {dailyLimitEnabled && <input type="number" min={1} value={dailyLimit} onChange={e => setDailyLimit(Math.max(1, parseInt(e.target.value) || 1))} className="ml-2 w-24 px-2 py-1 border border-[#D4D1C9] rounded" />}
                        </label>
                        <button onClick={() => advance('schedule')} disabled={whenMode === 'later' && (!scheduleDate || !scheduleClock)} className={contBtn}>Continue</button>
                      </Card>
                    )}

                  {stepState('create') === 'active' && (
                    <Card title="Ready to create" subtitle="I'll save this as a draft — launch it from the campaign when you're ready.">
                      <button onClick={create} disabled={creating || !audio || !senderNumber || selectedListIds.length === 0} className="w-full bg-[#D63B1F] hover:bg-[#c23119] text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-60">{creating ? 'Creating…' : 'Create voicemail campaign'}</button>
                    </Card>
                  )}
                </>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Composer — only before a draft exists; once drafted, edit in the card */}
          {!draft.script && (
            <div className="border-t border-[#E3E1DB] bg-white px-4 md:px-8 py-3 shrink-0">
              <div className="max-w-3xl mx-auto">
                <Composer rows={1} placeholder="Describe your voicemail…" {...composerProps} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
