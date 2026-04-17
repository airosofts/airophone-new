'use client'
// AudioUnlock.js
// Unlocks Web Audio API on the first user gesture so ringtones play in any tab state.
// Exposes window.__airoCtx (AudioContext) and window.__airoRingBuffer (decoded AudioBuffer)
// for use by playRingtone(). Also retries buffer load if a previous attempt failed.
import { useEffect } from 'react'

export default function AudioUnlock() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    // ── Pre-load on mount ──────────────────────────────────────────────────
    // 1. Create AudioContext immediately (suspended is fine for decodeAudioData)
    // 2. Try resume() right away — Chrome allows it if the user recently clicked
    //    anything on this origin (e.g. the Login button). This is a SPA so that
    //    click gesture persists across client-side navigation.
    // 3. Kick off buffer fetch + HTMLAudio preload in parallel — both work without gesture.
    const preloadOnMount = async () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return

        if (!window.__airoCtx || window.__airoCtx.state === 'closed') {
          window.__airoCtx = new AC()
        }
        const ctx = window.__airoCtx

        // Try resume immediately — succeeds if there was a recent user gesture
        // (e.g. login button click on this SPA). Silently ignore if blocked.
        if (ctx.state === 'suspended') {
          try {
            await Promise.race([
              ctx.resume(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 300))
            ])
            console.log('[AudioUnlock] ctx resumed on mount without gesture — ctx state:', ctx.state)
          } catch (_) {
            // Normal on first-ever visit. Will be resumed on first click.
          }
        }

        // If context is running, start keep-alive oscillator right away
        if (ctx.state === 'running' && !window.__airoKeepAlive) {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          gain.gain.value = 0
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start()
          window.__airoKeepAlive = { osc, gain }
          console.log('[AudioUnlock] Keep-alive started on mount')
          // Signal inbox to hide the banner
          window.dispatchEvent(new Event('airo:audio-unlocked'))
        }

        // Fetch + decode buffer (works regardless of ctx state)
        if (!window.__airoRingBuffer) {
          const res = await fetch('/call.mp3')
          if (!res.ok) return
          const arrayBuf = await res.arrayBuffer()
          window.__airoRingBuffer = await ctx.decodeAudioData(arrayBuf)
          console.log('[AudioUnlock] Buffer pre-decoded on mount, ctx state:', ctx.state)
        }

        // HTMLAudio preload — load() needs no gesture, play() does
        if (!window.__airoRingAudio) {
          const a = new Audio('/call.mp3')
          a.loop = true
          a.load()
          window.__airoRingAudio = a
          console.log('[AudioUnlock] HTMLAudio pre-loaded on mount')
        }
      } catch (e) {
        console.warn('[AudioUnlock] Mount pre-load failed:', e.message)
      }
    }
    preloadOnMount()
    // ───────────────────────────────────────────────────────────────────────

    const load = async () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return

        // Reuse existing running context if already set up
        let ctx = window.__airoCtx
        if (!ctx || ctx.state === 'closed') {
          ctx = new AC()
          window.__airoCtx = ctx
        }

        // Resume if suspended (required in some browsers even inside gesture)
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }

        // Play a 1-frame silent buffer — satisfies autoplay policy for HTMLAudioElement too
        const silent = ctx.createBuffer(1, 1, 22050)
        const silentSrc = ctx.createBufferSource()
        silentSrc.buffer = silent
        silentSrc.connect(ctx.destination)
        silentSrc.start(0)

        // If the context gets suspended/interrupted, log it but keep the buffer intact —
        // the decoded AudioBuffer data is always valid regardless of context state.
        // DO NOT clear __airoRingBuffer here: playRingtone() needs it to work.
        // The statechange listener just ensures we try to resume on the next gesture.
        ctx.addEventListener('statechange', () => {
          if (ctx.state === 'interrupted' || ctx.state === 'suspended') {
            console.log('[AudioUnlock] ctx state changed to', ctx.state, '— will resume on next gesture')
          }
        })

        // Skip decoding if buffer already ready
        if (window.__airoRingBuffer) return

        // Fetch and decode call.mp3 into an AudioBuffer.
        // Once decoded, playRingtone() uses createBufferSource() which bypasses
        // all autoplay restrictions — plays even in background tabs.
        const res = await fetch('/call.mp3')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const arrayBuf = await res.arrayBuffer()
        window.__airoRingBuffer = await ctx.decodeAudioData(arrayBuf)

        // Start a silent oscillator to keep the AudioContext in 'running' state.
        // A playing context is NOT suspended when the tab goes to the background,
        // so the ringtone BufferSourceNode will play even while the tab is hidden.
        if (!window.__airoKeepAlive) {
          try {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            gain.gain.value = 0 // completely silent
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start()
            window.__airoKeepAlive = { osc, gain }
            console.log('[AudioUnlock] Keep-alive oscillator started')
          } catch (e) {
            console.warn('[AudioUnlock] Keep-alive failed (non-critical):', e.message)
          }
        }

        // Also pre-load an HTMLAudio element as a backup ringtone.
        // HTMLAudio created + .load()-ed inside a gesture can be .play()-ed later
        // even in background tabs in Chrome, bypassing the autoplay restriction.
        if (!window.__airoRingAudio) {
          try {
            const a = new Audio('/call.mp3')
            a.loop = true
            a.load()
            window.__airoRingAudio = a
            console.log('[AudioUnlock] HTMLAudio backup pre-loaded')
          } catch (e) {
            console.warn('[AudioUnlock] HTMLAudio pre-load failed:', e.message)
          }
        }

        console.log('[AudioUnlock] Ringtone buffer ready — ctx state:', ctx.state)
        // Tell inbox page to hide the "Enable Audio" banner
        window.dispatchEvent(new Event('airo:audio-unlocked'))
      } catch (e) {
        console.warn('[AudioUnlock] Failed:', e.message)
        // Don't set __airoRingBuffer so next gesture retries
        window.__airoRingBuffer = null
      }
    }

    const events = ['click', 'touchstart', 'keydown', 'mousedown', 'pointerdown']

    // On every gesture: resume the context if suspended, then load buffer if missing.
    // Resuming on gesture is needed after the keep-alive oscillator is paused by the browser
    // on iOS Safari tab-switch or Chrome 136+ hardware interruption.
    // Also request notification permission once — must be inside a user gesture.
    const handler = () => {
      const ctx = window.__airoCtx
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
        ctx.resume().catch(() => {})
      }
      if (!window.__airoRingBuffer) {
        load()
      }
      // Request notification permission on first gesture if not yet decided
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(p => {
          console.log('[AudioUnlock] Notification permission:', p)
        }).catch(() => {})
      }
    }
    events.forEach(e => document.addEventListener(e, handler, { capture: true, passive: true }))

    // Also attempt immediately in case context was already unlocked
    // (e.g. user navigated from another page where they already clicked)
    if (window.__airoCtx && window.__airoCtx.state === 'running' && !window.__airoRingBuffer) {
      load()
    }

    return () => {
      events.forEach(e => document.removeEventListener(e, handler, { capture: true }))
    }
  }, [])

  return null
}
