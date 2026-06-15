'use client'

import { useEffect, useRef, useState } from 'react'

// WhatsApp-style voice-note player: a play/pause button + a waveform that
// fills as the clip plays. Real peaks are decoded from the audio when possible;
// otherwise a stable synthetic waveform is shown (playback still works).

const BARS = 40

let sharedCtx = null
function getAudioCtx() {
  if (typeof window === 'undefined') return null
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!sharedCtx) sharedCtx = new Ctx()
  return sharedCtx
}

// Deterministic pseudo-waveform from a string, so the fallback looks like a
// real (but stable) waveform rather than flat bars.
function synthPeaks(seed = 'x') {
  let h = 0
  for (let i = 0; i < seed.length; i++) { h = seed.charCodeAt(i) + ((h << 5) - h); h |= 0 }
  let x = Math.abs(h) % 100000
  const out = []
  for (let i = 0; i < BARS; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out.push(0.22 + (x % 1000) / 1000 * 0.78)
  }
  return out
}

function fmtTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export default function VoiceNotePlayer({ src, accent = '#D63B1F', muted = '#C4C2BC' }) {
  const audioRef = useRef(null)
  const [peaks, setPeaks] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)

  // Decode the clip to extract a real waveform (best-effort).
  useEffect(() => {
    let cancelled = false
    setPeaks(null)
    if (!src) return
    ;(async () => {
      try {
        const res = await fetch(src)
        const buf = await res.arrayBuffer()
        const ctx = getAudioCtx()
        if (!ctx) throw new Error('no AudioContext')
        const audioBuf = await ctx.decodeAudioData(buf)
        if (cancelled) return
        const raw = audioBuf.getChannelData(0)
        const block = Math.floor(raw.length / BARS) || 1
        const out = []
        for (let i = 0; i < BARS; i++) {
          let sum = 0
          for (let j = 0; j < block; j++) sum += Math.abs(raw[i * block + j] || 0)
          out.push(sum / block)
        }
        const max = Math.max(...out) || 1
        setPeaks(out.map(v => Math.max(0.12, v / max)))
      } catch {
        if (!cancelled) setPeaks(synthPeaks(src))
      }
    })()
    return () => { cancelled = true }
  }, [src])

  const displayPeaks = peaks || synthPeaks(src || 'x')
  const progress = duration ? current / duration : 0

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  const seek = (e) => {
    const a = audioRef.current
    if (!a || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    a.currentTime = frac * duration
    setCurrent(a.currentTime)
  }

  // MediaRecorder WebM blobs often report duration=Infinity until seeked — nudge it.
  const onLoadedMetadata = (e) => {
    const a = e.currentTarget
    if (a.duration === Infinity || isNaN(a.duration)) {
      const fix = () => {
        a.removeEventListener('timeupdate', fix)
        a.currentTime = 0
        setDuration(a.duration)
      }
      a.addEventListener('timeupdate', fix)
      a.currentTime = 1e101
    } else {
      setDuration(a.duration)
    }
  }

  return (
    <div className="flex items-center gap-2.5" style={{ minWidth: 200 }}>
      <button
        type="button"
        onClick={toggle}
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-90"
        style={{ background: accent, color: '#fff' }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div onClick={seek} className="flex items-center gap-[2px] h-7 cursor-pointer" style={{ minWidth: 130 }}>
          {displayPeaks.map((p, i) => {
            const played = (i + 0.5) / BARS <= progress
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${Math.round(p * 100)}%`,
                  minHeight: 3,
                  borderRadius: 2,
                  background: played ? accent : muted,
                  transition: 'background 0.1s',
                }}
              />
            )
          })}
        </div>
        <div className="text-[10px] text-[#9B9890] mt-0.5 font-mono tabular-nums">
          {fmtTime(current > 0 ? current : duration)}
        </div>
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0) }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={onLoadedMetadata}
      />
    </div>
  )
}
