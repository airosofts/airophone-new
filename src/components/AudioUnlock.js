'use client'
// AudioUnlock.js
// Unlocks Web Audio API on the first user gesture so ringtones play in any tab state.
// Exposes window.__airoCtx (AudioContext) and window.__airoRingBuffer (decoded AudioBuffer)
// for use by playRingtone(). Also retries buffer load if a previous attempt failed.
import { useEffect } from 'react'

export default function AudioUnlock() {
  useEffect(() => {
    if (typeof window === 'undefined') return

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

        console.log('[AudioUnlock] Ringtone buffer ready — ctx state:', ctx.state)
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
